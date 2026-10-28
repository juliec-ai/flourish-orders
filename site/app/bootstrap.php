<?php
// Loads config.php (kept outside public_html) and wires the app together.
declare(strict_types=1);

foreach (['UserError', 'Store', 'Infinity', 'Auth', 'Orders', 'Api'] as $class) require_once __DIR__ . "/$class.php";

function load_app(): Api
{
    $file = dirname(__DIR__) . '/config.php';
    if (!is_file($file)) throw new RuntimeException('config.php is missing. Copy config.sample.php to config.php and fill it in.');
    $config = require $file;
    if (empty($config['infinity_token'])) throw new RuntimeException('infinity_token is empty in config.php');
    date_default_timezone_set($config['timezone'] ?? 'America/Denver');

    $store = new Store($config['data_dir']);
    $inf = new Infinity($config['infinity_token'], (string) $config['workspace'], $store, $config['ca_bundle'] ?? null);
    $auth = new Auth((string) $config['session_secret'], $config['staff'] ?? [], $store);
    return new Api($config, $inf, $auth, $store);
}
