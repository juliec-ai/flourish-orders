<?php
// Staff login: email + PIN checked against config, with a signed session cookie.
final class Auth
{
    private const COOKIE = 'fo_session';
    private const SESSION_HOURS = 12;
    private const MAX_FAILS = 5;
    private const LOCK_MINUTES = 15;

    private array $staff = [];

    public function __construct(private string $secret, array $staff, private Store $store)
    {
        if (strlen($secret) < 32) throw new RuntimeException('session_secret in config.php must be at least 32 characters');
        foreach ($staff as $s) $this->staff[strtolower(trim($s['email']))] = $s;
    }

    public function sign(array $payload): string
    {
        $body = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
        return $body . '.' . hash_hmac('sha256', $body, $this->secret);
    }

    public function verify(?string $token): ?array
    {
        [$body, $mac] = array_pad(explode('.', (string) $token, 2), 2, '');
        if ($body === '' || !hash_equals(hash_hmac('sha256', $body, $this->secret), $mac)) return null;
        $payload = json_decode(base64_decode(strtr($body, '-_', '+/')), true);
        return is_array($payload) && ($payload['exp'] ?? 0) > time() ? $payload : null;
    }

    private function setCookie(string $value, int $maxAge): void
    {
        setcookie(self::COOKIE, $value, [
            'expires' => $maxAge ? time() + $maxAge : 1,
            'path' => '/',
            'secure' => ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off',
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    public function login(string $email, string $pin): array
    {
        $email = strtolower(trim($email));
        $key = 'fails-' . hash('sha256', $email);
        $f = $this->store->get($key) ?? ['count' => 0, 'until' => 0];
        if ($f['until'] > time()) throw new UserError('Too many tries. Wait 15 minutes and try again.', 429);

        $user = $this->staff[$email] ?? null;
        if (!$user || !password_verify(trim($pin), $user['pin'] ?? '')) {
            $f['count']++;
            if ($f['count'] >= self::MAX_FAILS) $f = ['count' => 0, 'until' => time() + self::LOCK_MINUTES * 60];
            $this->store->set($key, $f, self::LOCK_MINUTES * 60);
            throw new UserError('Email or PIN is not right.', 401);
        }
        $this->store->forget($key);
        $this->setCookie($this->sign(['email' => $email, 'exp' => time() + self::SESSION_HOURS * 3600]), self::SESSION_HOURS * 3600);
        return ['name' => $user['name']];
    }

    public function logout(): void
    {
        $this->setCookie('', 0);
    }

    // The signed-in staff member, or a 401.
    public function staff(): array
    {
        $session = $this->verify($_COOKIE[self::COOKIE] ?? null);
        $user = $session ? ($this->staff[$session['email']] ?? null) : null;
        if (!$user) throw new UserError('Please sign in.', 401);
        return $user + ['email' => $session['email']];
    }
}
