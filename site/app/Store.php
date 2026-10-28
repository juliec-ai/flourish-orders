<?php
// Small file store for caches and login lockouts (shared hosting has no Redis).
final class Store
{
    public function __construct(private string $dir)
    {
        if (!is_dir($dir)) mkdir($dir, 0700, true);
    }

    private function path(string $key): string
    {
        return $this->dir . '/' . preg_replace('/[^a-z0-9_-]/i', '_', $key) . '.json';
    }

    public function get(string $key): mixed
    {
        $raw = @file_get_contents($this->path($key));
        if ($raw === false) return null;
        $row = json_decode($raw, true);
        if (!is_array($row) || ($row['until'] ?? 0) < time()) return null;
        return $row['value'];
    }

    public function set(string $key, mixed $value, int $seconds): void
    {
        file_put_contents($this->path($key), json_encode(['until' => time() + $seconds, 'value' => $value]), LOCK_EX);
    }

    public function forget(string $key): void
    {
        @unlink($this->path($key));
    }

    public function remember(string $key, int $seconds, callable $load): mixed
    {
        $hit = $this->get($key);
        if ($hit !== null) return $hit;
        $value = $load();
        $this->set($key, $value, $seconds);
        return $value;
    }

    // Runs $fn while holding an exclusive lock, so two requests can't interleave.
    public function locked(string $name, callable $fn): mixed
    {
        $h = fopen($this->path("lock-$name"), 'c');
        flock($h, LOCK_EX);
        try {
            return $fn();
        } finally {
            flock($h, LOCK_UN);
            fclose($h);
        }
    }
}
