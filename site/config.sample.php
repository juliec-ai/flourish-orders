<?php
// Copy this file to config.php (next to the public_html folder, never inside it) and fill it in.
return [
    // Infinity API token (Profile > Developer > Tokens). Stays on the server.
    'infinity_token' => '',

    // Brigham Floral (BRGM) workspace and the order boards
    'workspace' => '62514',
    'boards' => [
        'customers' => '692YNE7vaYz',
        'products' => 'ar2atxGwR7m',
        'orders' => '9VF3MFPmMZL',
    ],

    // Long random text used to sign login cookies. Make one with: php tools/hash-pin.php --secret
    'session_secret' => '',

    // Staff who can sign in. Make each "pin" with: php tools/hash-pin.php 1234
    // Optional 'infinity_user_id' fills the Orders "Taken By" member field.
    'staff' => [
        // ['name' => 'Julie', 'email' => 'julie@brighamfloral.com', 'pin' => '$2y$10$...'],
    ],

    'tax_rate' => 0,          // as a decimal, for example 0.0725
    'delivery_fee' => 0,      // default delivery fee in dollars
    'default_brand' => 'Brigham Floral and Gift',
    'timezone' => 'America/Denver',

    // Folder for short-lived cache and login lockouts. Must be writable and outside public_html.
    'data_dir' => __DIR__ . '/data',
];
