<?php
// Staff API: everything the order screen calls lives here.
final class Api
{
    private const CHANNEL_TO_SOURCE = ['Counter' => 'Walk-in', 'Phone' => 'Phone', 'Website' => 'Website', 'FSN Network' => 'FSN Network'];
    private const DONE = ['Picked Up', 'Delivered', 'Cancelled'];

    private array $boards;

    public function __construct(private array $config, private Infinity $inf, private Auth $auth, private Store $store)
    {
        $this->boards = $config['boards'];
    }

    // Returns [status, body].
    public function handle(string $method, string $route, array $body, array $query): array
    {
        if ($method !== 'GET' && !str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
            return [415, ['error' => 'JSON only']];
        }
        if ($method === 'POST' && $route === 'login') return [200, $this->auth->login((string) ($body['email'] ?? ''), (string) ($body['pin'] ?? ''))];
        if ($method === 'POST' && $route === 'logout') {
            $this->auth->logout();
            return [200, ['ok' => true]];
        }

        $staff = $this->auth->staff();
        return match (true) {
            $method === 'GET' && $route === 'me' => [200, ['name' => $staff['name'], 'email' => $staff['email']]],
            $method === 'GET' && $route === 'options' => [200, $this->options()],
            $method === 'GET' && $route === 'products' => [200, $this->products()],
            $method === 'GET' && $route === 'customers' => [200, $this->customers((string) ($query['q'] ?? ''))],
            $method === 'GET' && $route === 'orders' => [200, $this->orders(($query['done'] ?? '') === '1')],
            $method === 'POST' && $route === 'orders' => [201, $this->createOrder($body, $staff)],
            $method === 'PATCH' && preg_match('#^orders/([\w-]+)$#', $route, $m) === 1 => [200, $this->updateOrder($m[1], $body)],
            default => [404, ['error' => 'Not found']],
        };
    }

    // All items on a board, flattened, cached for a minute so searching doesn't hit Infinity's rate limit.
    private function all(string $key): array
    {
        $board = $this->boards[$key];
        return $this->store->remember("items-$key", 60, fn() => array_map(
            fn($i) => $this->inf->flatten($board, $i),
            $this->inf->listItems($board),
        ));
    }

    private function options(): array
    {
        $o = $this->inf->schema($this->boards['orders'])['byName'];
        $c = $this->inf->schema($this->boards['customers'])['byName'];
        $labels = fn($s, $name) => array_keys($s[$name]['labels'] ?? []);
        return [
            'occasion' => $labels($o, 'Occasion'),
            'fulfillment' => $labels($o, 'Fulfillment'),
            'channel' => $labels($o, 'Channel'),
            'status' => $labels($o, 'Status'),
            'paymentStatus' => $labels($o, 'Payment Status'),
            'brand' => $labels($o, 'Brand'),
            'customerType' => $labels($c, 'Customer Type'),
            'taxRate' => (float) $this->config['tax_rate'],
            'deliveryFee' => (float) $this->config['delivery_fee'],
            'defaultBrand' => $this->config['default_brand'],
        ];
    }

    private function products(): array
    {
        $list = [];
        foreach ($this->all('products') as $p) {
            if (($p['Active'] ?? null) === false || empty($p['Name'])) continue;
            $list[] = [
                'id' => $p['id'],
                'name' => $p['Name'],
                'size' => $p['Size'][0] ?? '',
                'category' => $p['Category'][0] ?? '',
                'brand' => $p['Brand'][0] ?? '',
                'price' => (float) ($p['Price'] ?? 0),
                'taxable' => ($p['Taxable'] ?? null) !== false,
            ];
        }
        usort($list, fn($a, $b) => strcasecmp($a['name'], $b['name']));
        return $list;
    }

    private function customers(string $q): array
    {
        $q = mb_strtolower(trim($q));
        $digits = preg_replace('/\D/', '', $q);
        $hits = [];
        foreach ($this->all('customers') as $c) {
            $match = $q === ''
                || str_contains(mb_strtolower($c['Name'] ?? ''), $q)
                || str_contains(mb_strtolower($c['Email'] ?? ''), $q)
                || (strlen($digits) >= 3 && str_contains(preg_replace('/\D/', '', (string) ($c['Phone'] ?? '')), $digits));
            if (!$match) continue;
            $hits[] = [
                'id' => $c['id'],
                'name' => $c['Name'] ?? '',
                'phone' => $c['Phone'] ?? '',
                'email' => $c['Email'] ?? '',
                'address' => implode(', ', array_filter([$c['Address'] ?? '', $c['City'] ?? '', $c['State'] ?? '', $c['ZIP'] ?? ''])),
                'taxExempt' => ($c['Tax Exempt'] ?? null) === true,
                'houseAccount' => ($c['House Account'] ?? null) === true,
            ];
            if (count($hits) >= 20) break;
        }
        return $hits;
    }

    private function orders(bool $showDone): array
    {
        $list = [];
        foreach ($this->all('orders') as $o) {
            $status = $o['Status'][0] ?? '';
            if (!$showDone && in_array($status, self::DONE, true)) continue;
            $list[] = [
                'id' => $o['id'],
                'number' => $o['Order Number'] ?? '',
                'name' => $o['Name'] ?? '',
                'recipient' => $o['Recipient Name'] ?? '',
                'address' => $o['Recipient Address'] ?? '',
                'due' => $o['Due Date'] ?? '',
                'dueLabel' => Orders::dueLabel($o['Due Date'] ?? null, $this->config['timezone']),
                'fulfillment' => $o['Fulfillment'][0] ?? '',
                'status' => $status,
                'paymentStatus' => $o['Payment Status'][0] ?? '',
                'brand' => $o['Brand'][0] ?? '',
                'total' => (float) ($o['Total'] ?? 0),
                'lineItems' => $o['Line Items'] ?? '',
                'cardMessage' => $o['Card Message'] ?? '',
                'notes' => $o['Notes'] ?? '',
                'createdAt' => $o['created_at'],
            ];
        }
        usort($list, fn($a, $b) => strcmp((string) $a['due'], (string) $b['due']));
        return $list;
    }

    private function createOrder(array $order, array $staff): array
    {
        $lines = Orders::validate($order);

        // One order at a time, so two staff saving together can't get the same number.
        return $this->store->locked('create-order', function () use ($order, $lines, $staff) {
            $customerId = (string) ($order['customer']['id'] ?? '');
            $taxExempt = false;
            if ($customerId !== '') {
                foreach ($this->all('customers') as $c) {
                    if ($c['id'] === $customerId) $taxExempt = ($c['Tax Exempt'] ?? null) === true;
                }
            } else {
                $source = self::CHANNEL_TO_SOURCE[$order['channel'] ?? ''] ?? null;
                $customerId = $this->inf->createItem($this->boards['customers'], Orders::customerFields($order['customer'], $source))['id'];
                $this->store->forget('items-customers');
            }

            $delivery = ($order['fulfillment'] ?? '') === 'Delivery';
            $fee = $delivery ? (float) ($order['deliveryFee'] ?? $this->config['delivery_fee']) : 0;
            $totals = Orders::computeTotals($lines, $fee, (float) $this->config['tax_rate'], $taxExempt);

            $this->store->forget('items-orders');
            $existing = array_map(fn($o) => $o['Order Number'] ?? null, $this->all('orders'));
            $number = Orders::nextOrderNumber($existing, Orders::datePrefix(null, $this->config['timezone']));
            $created = $this->inf->createItem($this->boards['orders'], Orders::orderFields($order, $lines, $totals, $number, $customerId, $staff, $this->config['timezone']));
            $this->store->forget('items-orders');
            return ['id' => $created['id'], 'number' => $number, 'totals' => $totals];
        });
    }

    private function updateOrder(string $id, array $b): array
    {
        $fields = array_filter([
            'Status' => $b['status'] ?? null,
            'Payment Status' => $b['paymentStatus'] ?? null,
            'Stripe Payment ID' => $b['stripePaymentId'] ?? null,
        ]);
        if (!$fields) throw new UserError('Nothing to change.');
        $this->inf->updateItem($this->boards['orders'], $id, $fields);
        $this->store->forget('items-orders');
        return ['ok' => true];
    }
}
