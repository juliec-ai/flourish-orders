<?php
// Thin Infinity API client. Looks attributes up by name so the code
// keeps working if fields are reordered or recreated on the boards.
final class InfinityError extends RuntimeException {}

final class Infinity
{
    private const BASE = 'https://app.startinfinity.com/api/v2';
    private const API_VERSION = '2025-12-01.morava';
    private array $schemas = [];

    public function __construct(private string $token, private string $workspace, private Store $store, private ?string $caBundle = null) {}

    public function call(string $method, string $path, ?array $body = null): mixed
    {
        $ch = curl_init(self::BASE . "/workspaces/{$this->workspace}$path");
        $headers = ["Authorization: Bearer {$this->token}", 'X-API-Version: ' . self::API_VERSION, 'Accept: application/json'];
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_USERAGENT => 'flourish-orders',
        ]);
        if ($this->caBundle) curl_setopt($ch, CURLOPT_CAINFO, $this->caBundle);
        $text = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($text === false) throw new InfinityError("Infinity API unreachable: $err");
        $data = $text === '' ? null : json_decode($text, true);
        if ($status < 200 || $status >= 300) throw new InfinityError("Infinity API $status: $text");
        return $data;
    }

    // ['folderId' => ..., 'byName' => ['Name' => ['id', 'type', 'labels' => [labelName => labelId]]]]
    public function schema(string $board): array
    {
        return $this->schemas[$board] ??= $this->store->remember("schema-$board", 600, function () use ($board) {
            $attrs = $this->call('GET', "/boards/$board/attributes?limit=100");
            $folders = $this->call('GET', "/boards/$board/folders?limit=100");
            $byName = [];
            foreach ($attrs['data'] as $a) {
                $labels = [];
                foreach ($a['settings']['labels'] ?? [] as $l) $labels[$l['name']] = $l['id'];
                $byName[$a['name']] = ['id' => $a['id'], 'type' => $a['type'], 'labels' => $labels];
            }
            return ['folderId' => $folders['data'][0]['id'] ?? null, 'byName' => $byName];
        });
    }

    public function listItems(string $board, int $max = 1000): array
    {
        $out = [];
        $after = '';
        while (count($out) < $max) {
            $q = 'limit=100&expand%5B%5D=values' . ($after ? '&after=' . urlencode($after) : '');
            $page = $this->call('GET', "/boards/$board/items?$q");
            foreach ($page['data'] as $item) if (empty($item['deleted'])) $out[] = $item;
            if (empty($page['has_more']) || empty($page['after'])) break;
            $after = $page['after'];
        }
        return $out;
    }

    // Turns an item's values into ['Attribute Name' => value], with labels as names.
    public function flatten(string $board, array $item): array
    {
        $byId = [];
        foreach ($this->schema($board)['byName'] as $name => $a) $byId[$a['id']] = ['name' => $name] + $a;
        $out = ['id' => $item['id'], 'created_at' => $item['created_at'] ?? null];
        foreach ($item['values'] ?? [] as $v) {
            $a = $byId[$v['attribute_id'] ?? ''] ?? null;
            if (!$a) continue;
            if ($a['type'] === 'label') {
                $names = array_flip($a['labels']);
                $out[$a['name']] = array_values(array_filter(array_map(fn($id) => $names[$id] ?? null, (array) $v['data'])));
            } else {
                $out[$a['name']] = $v['data'];
            }
        }
        return $out;
    }

    // Builds the values array for a create/update from ['Attribute Name' => value].
    // Label values are given by label name; empty values are skipped.
    public function toValues(string $board, array $fields): array
    {
        $s = $this->schema($board);
        $values = [];
        foreach ($fields as $name => $value) {
            if ($value === null || $value === '' || $value === []) continue;
            $a = $s['byName'][$name] ?? throw new RuntimeException("Board $board has no field \"$name\"");
            $data = match ($a['type']) {
                'label' => array_map(
                    fn($n) => $a['labels'][$n] ?? throw new UserError("\"$n\" is not an option for $name."),
                    (array) $value,
                ),
                'reference', 'members' => array_values((array) $value),
                'number' => (float) $value,
                'checkbox' => (bool) $value,
                default => $value,
            };
            $values[] = ['attribute_id' => $a['id'], 'data' => $data];
        }
        return $values;
    }

    // Reference fields can't be set on create; Infinity wants them added
    // afterwards through the references endpoint, one link per target item.
    public function createItem(string $board, array $fields): array
    {
        $byName = $this->schema($board)['byName'];
        $refs = [];
        foreach ($fields as $name => $value) {
            if (($byName[$name]['type'] ?? '') === 'reference') {
                $refs[$byName[$name]['id']] = array_values(array_filter((array) $value));
                unset($fields[$name]);
            }
        }
        $body = ['folder_id' => $this->schema($board)['folderId'], 'values' => $this->toValues($board, $fields)];
        $item = $this->call('POST', "/boards/$board/items", $body);
        foreach ($refs as $attributeId => $targets) {
            foreach ($targets as $to) {
                $this->call('POST', "/boards/$board/references", ['attribute_id' => $attributeId, 'from_item_id' => $item['id'], 'to_item_id' => $to]);
            }
        }
        return $item;
    }

    public function updateItem(string $board, string $itemId, array $fields): array
    {
        return $this->call('PUT', "/boards/$board/items/" . rawurlencode($itemId), ['values' => $this->toValues($board, $fields)]);
    }
}
