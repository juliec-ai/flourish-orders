<?php
// Usage: php tools/hash-pin.php 1234     prints a hashed PIN for config.php
//        php tools/hash-pin.php --secret prints a new session_secret
if (PHP_SAPI !== 'cli') exit;
$arg = $argv[1] ?? '';
if ($arg === '--secret') {
    echo bin2hex(random_bytes(32)), PHP_EOL;
} elseif (preg_match('/^\d{4,8}$/', $arg)) {
    echo password_hash($arg, PASSWORD_DEFAULT), PHP_EOL;
} else {
    fwrite(STDERR, "Usage: php tools/hash-pin.php 1234   (PIN is 4 to 8 digits)\n       php tools/hash-pin.php --secret\n");
    exit(1);
}
