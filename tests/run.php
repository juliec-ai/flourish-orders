<?php
// Run with: php tests/run.php
require __DIR__ . '/../site/app/UserError.php';
require __DIR__ . '/../site/app/Store.php';
require __DIR__ . '/../site/app/Orders.php';
require __DIR__ . '/../site/app/Auth.php';

$failed = 0;
function check(string $name, bool $ok): void
{
    global $failed;
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . PHP_EOL;
    if (!$ok) $failed++;
}
function throws(callable $fn, string $pattern): bool
{
    try {
        $fn();
    } catch (UserError $e) {
        return preg_match($pattern, $e->getMessage()) === 1;
    }
    return false;
}

$lines = [['qty' => 2, 'price' => 45, 'taxable' => true], ['qty' => 1, 'price' => 10, 'taxable' => false]];
check('totals tax only taxable lines', Orders::computeTotals($lines, 12.5, 0.0725) === ['subtotal' => 100.0, 'deliveryFee' => 12.5, 'tax' => 6.53, 'total' => 119.03]);
check('tax-exempt customers pay no tax', Orders::computeTotals($lines, 0, 0.0725, true)['tax'] === 0.0);

check('first order of the day is -01', Orders::nextOrderNumber([], '261028') === '261028-01');
check('order numbers count up within the day', Orders::nextOrderNumber(['261028-01', '261028-09', '261027-14', null], '261028') === '261028-10');
check('date prefix uses the shop time zone', Orders::datePrefix(new DateTimeImmutable('2026-10-29T03:00:00Z'), 'America/Denver') === '261028');

check('validation lists what is missing', throws(fn() => Orders::validate(['lines' => []]), '/customer.*item.*due date/s'));
check('delivery needs an address', throws(fn() => Orders::validate([
    'customer' => ['name' => 'A'], 'lines' => [['name' => 'Roses', 'qty' => 1, 'price' => 5]],
    'fulfillment' => 'Delivery', 'dueDate' => '2026-10-28', 'recipient' => [],
]), '/recipient address/'));
check('validation cleans lines', Orders::validate([
    'customer' => ['id' => 'x'], 'lines' => [['name' => 'Roses', 'qty' => '2', 'price' => '5'], ['name' => '']],
    'fulfillment' => 'Pickup', 'dueDate' => '2026-10-28',
]) === [['productId' => null, 'name' => 'Roses', 'qty' => 2.0, 'price' => 5.0, 'taxable' => true]]);
check('line items read well', Orders::lineItemsText([['qty' => 2.0, 'name' => 'Roses', 'price' => 5.0, 'taxable' => false]]) === '2 x Roses @ $5.00 = $10.00 (no tax)');
check('due time is sent to Infinity in UTC', Orders::dueDateValue('2026-10-30', '14:30', 'America/Denver') === '2026-10-30 20:30:00');
check('due date without time stays a date', Orders::dueDateValue('2026-10-30', '', 'America/Denver') === '2026-10-30');
check('due label shows shop time', Orders::dueLabel('2026-10-30T20:30:00.000000Z', 'America/Denver') === 'Fri, Oct 30, 2:30 PM');
check('due label for a date with no time', Orders::dueLabel('2026-10-30T00:00:00.000000Z', 'America/Denver') === 'Fri, Oct 30');

$store = new Store(sys_get_temp_dir() . '/fo-test-' . getmypid());
$auth = new Auth(str_repeat('s', 32), [], $store);
$tok = $auth->sign(['email' => 'a@b.c', 'exp' => time() + 60]);
check('session cookie verifies', ($auth->verify($tok)['email'] ?? null) === 'a@b.c');
check('tampered cookie is rejected', $auth->verify($tok . 'x') === null);
check('expired cookie is rejected', $auth->verify($auth->sign(['email' => 'a', 'exp' => time() - 1])) === null);
check('other secret is rejected', (new Auth(str_repeat('t', 32), [], $store))->verify($tok) === null);

exit($failed ? 1 : 0);
