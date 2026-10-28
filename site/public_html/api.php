<?php
// Every /api/... request lands here (see .htaccess).
require dirname(__DIR__) . '/app/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
$route = trim((string) preg_replace('#^.*?/api/?#', '', $path), '/');
$body = json_decode(file_get_contents('php://input') ?: '[]', true);

try {
    [$status, $out] = load_app()->handle($_SERVER['REQUEST_METHOD'] ?? 'GET', $route, is_array($body) ? $body : [], $_GET);
} catch (UserError $e) {
    [$status, $out] = [$e->status(), ['error' => $e->getMessage()]];
} catch (InfinityError $e) {
    error_log($e->getMessage());
    // Infinity's own message (never the token) helps staff and Claude see what went wrong.
    $detail = preg_replace('/\s+/', ' ', mb_substr($e->getMessage(), 0, 400));
    [$status, $out] = [502, ['error' => "Problem talking to Infinity: $detail"]];
} catch (Throwable $e) {
    error_log((string) $e);
    [$status, $out] = [500, ['error' => 'Something went wrong on the server: ' . mb_substr($e->getMessage(), 0, 300)]];
}

http_response_code($status);
echo json_encode($out);
