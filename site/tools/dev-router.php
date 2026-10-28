<?php
// Local testing only: php -S localhost:8000 -t public_html tools/dev-router.php
// (stands in for the .htaccess rewrite that Apache does on SiteGround)
if (preg_match('#^/api(/|$)#', parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH))) {
    require __DIR__ . '/../public_html/api.php';
    return true;
}
return false;
