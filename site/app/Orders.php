<?php
// Order rules: totals, order numbers, and the Infinity field mapping.
final class Orders
{
    public static function money(float $n): float
    {
        return round($n, 2);
    }

    private static function fmt(float $n): string
    {
        return '$' . number_format($n, 2, '.', '');
    }

    // Today's date in the shop's time zone, as YYMMDD.
    public static function datePrefix(?DateTimeImmutable $now = null, string $tz = 'America/Denver'): string
    {
        return ($now ?? new DateTimeImmutable())->setTimezone(new DateTimeZone($tz))->format('ymd');
    }

    // Next order number for today, such as 261028-03, given the existing numbers.
    public static function nextOrderNumber(array $existing, string $prefix): string
    {
        $max = 0;
        foreach ($existing as $n) {
            if (preg_match('/^' . preg_quote($prefix, '/') . '-(\d+)$/', (string) $n, $m)) $max = max($max, (int) $m[1]);
        }
        return sprintf('%s-%02d', $prefix, $max + 1);
    }

    public static function computeTotals(array $lines, float $deliveryFee = 0, float $taxRate = 0, bool $taxExempt = false): array
    {
        $subtotal = 0.0;
        $taxable = 0.0;
        foreach ($lines as $l) {
            $amount = self::money($l['qty'] * $l['price']);
            $subtotal += $amount;
            if ($l['taxable']) $taxable += $amount;
        }
        $subtotal = self::money($subtotal);
        $tax = $taxExempt ? 0.0 : self::money($taxable * $taxRate);
        $fee = self::money($deliveryFee);
        return ['subtotal' => $subtotal, 'deliveryFee' => $fee, 'tax' => $tax, 'total' => self::money($subtotal + $fee + $tax)];
    }

    public static function lineItemsText(array $lines): string
    {
        return implode("\n", array_map(
            fn($l) => sprintf('%s x %s @ %s = %s%s', $l['qty'] + 0, $l['name'], self::fmt($l['price']), self::fmt($l['qty'] * $l['price']), $l['taxable'] ? '' : ' (no tax)'),
            $lines,
        ));
    }

    // Checks the order sent by the browser and returns clean lines, or throws with a message for staff.
    public static function validate(array $o): array
    {
        $errors = [];
        $c = $o['customer'] ?? null;
        if (!is_array($c) || (empty($c['id']) && trim((string) ($c['name'] ?? '')) === '')) $errors[] = 'Choose or add a customer.';
        $lines = [];
        foreach ((array) ($o['lines'] ?? []) as $l) {
            $name = trim((string) ($l['name'] ?? ''));
            if ($name === '') continue;
            $lines[] = [
                'productId' => ($l['productId'] ?? null) ?: null,
                'name' => $name,
                'qty' => is_numeric($l['qty'] ?? null) ? (float) $l['qty'] : 0,
                'price' => is_numeric($l['price'] ?? null) ? (float) $l['price'] : -1,
                'taxable' => ($l['taxable'] ?? true) !== false,
            ];
        }
        if (!$lines) $errors[] = 'Add at least one item.';
        foreach ($lines as $l) {
            if ($l['qty'] <= 0 || $l['price'] < 0) $errors[] = "Check quantity and price for \"{$l['name']}\".";
        }
        if (empty($o['fulfillment'])) $errors[] = 'Choose how the order goes out (pickup, delivery, or walk-in).';
        if (empty($o['dueDate']) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $o['dueDate'])) $errors[] = 'Set the due date.';
        if (!empty($o['dueTime']) && !preg_match('/^\d{2}:\d{2}$/', $o['dueTime'])) $errors[] = 'Check the due time.';
        if (($o['fulfillment'] ?? '') === 'Delivery' && trim((string) ($o['recipient']['address'] ?? '')) === '') {
            $errors[] = 'Delivery orders need a recipient address.';
        }
        if ($errors) throw new UserError(implode(' ', $errors));
        return $lines;
    }

    // Infinity "date with time" value from the form's date and time inputs.
    public static function dueDateValue(string $date, ?string $time): string
    {
        return $time ? "$date $time:00" : $date;
    }

    public static function orderFields(array $order, array $lines, array $totals, string $number, string $customerId, array $staff): array
    {
        $r = $order['recipient'] ?? [];
        $customerName = trim((string) ($order['customer']['name'] ?? ''));
        $recipientName = trim((string) ($r['name'] ?? ''));
        $notes = "Taken by: {$staff['name']}" . (trim((string) ($order['notes'] ?? '')) !== '' ? "\n" . trim($order['notes']) : '');
        return [
            'Name' => trim("$number $customerName" . ($recipientName !== '' ? " for $recipientName" : '')),
            'Order Number' => $number,
            'Customer' => $customerId,
            'Recipient Name' => $recipientName,
            'Recipient Phone' => trim((string) ($r['phone'] ?? '')),
            'Recipient Address' => trim((string) ($r['address'] ?? '')),
            'Products' => array_values(array_unique(array_filter(array_column($lines, 'productId')))),
            'Line Items' => self::lineItemsText($lines),
            'Card Message' => trim((string) ($order['cardMessage'] ?? '')),
            'Occasion' => $order['occasion'] ?? null,
            'Fulfillment' => $order['fulfillment'],
            'Due Date' => self::dueDateValue($order['dueDate'], $order['dueTime'] ?? null),
            'Subtotal' => $totals['subtotal'],
            'Delivery Fee' => $totals['deliveryFee'],
            'Tax' => $totals['tax'],
            'Total' => $totals['total'],
            'Payment Status' => ($order['paymentStatus'] ?? '') ?: 'Unpaid',
            'Stripe Payment ID' => trim((string) ($order['stripePaymentId'] ?? '')),
            'Channel' => $order['channel'] ?? null,
            'Status' => 'New',
            'Taken By' => $staff['infinity_user_id'] ?? null,
            'Brand' => $order['brand'] ?? null,
            'Notes' => $notes,
        ];
    }

    public static function customerFields(array $c, ?string $source): array
    {
        $f = fn($k) => trim((string) ($c[$k] ?? ''));
        return [
            'Name' => $f('name'), 'Phone' => $f('phone'), 'Email' => $f('email'), 'Address' => $f('address'),
            'City' => $f('city'), 'State' => $f('state'), 'ZIP' => $f('zip'), 'Source' => $source,
        ];
    }
}
