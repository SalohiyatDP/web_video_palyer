<?php
declare(strict_types=1);
/**
 * «Namangan turistik-rekreatsion hududlarini rivojlantirish direksiyasi» —
 * yer maydonlari video arxivi. PHP varianti (oddiy hostinglar uchun).
 *
 * Videolar hostingdagi `data/uploads/` papkasiga saqlanadi, ma'lumotlar —
 * `data/videos.json` faylida. Ma'lumotlar bazasi talab qilinmaydi.
 *
 * Videolar katta bo'lishi mumkin, shuning uchun yuklash BO'LAKLAB amalga
 * oshiriladi — bu hostinglardagi `post_max_size` / `upload_max_filesize`
 * chegaralarini chetlab o'tadi.
 */

/* ==================================================================== *
 *  SOZLAMALAR — bu blokni o'zingizga moslab o'zgartiring
 * ==================================================================== */

/** Administrator paroli (video yuklash va o'chirish uchun). */
$ADMIN_PASSWORD = getenv('ADMIN_PASSWORD') ?: 'namangan2026';

/** QR-kodlar uchun saytning to'liq manzili. Bo'sh bo'lsa — avtomatik aniqlanadi. */
$PUBLIC_BASE_URL = getenv('PUBLIC_BASE_URL') ?: '';

/** Bitta videoning maksimal hajmi (bayt). Standart: 1 GB. */
$MAX_UPLOAD_BYTES = (int) (getenv('MAX_UPLOAD_BYTES') ?: 1024 * 1024 * 1024);

/**
 * Yuklashda bitta bo'lak hajmi (bayt). 4 MB — hostinglarning standart
 * `post_max_size = 8M` chegarasiga bemalol sig'adi.
 */
$CHUNK_BYTES = (int) (getenv('CHUNK_BYTES') ?: 4 * 1024 * 1024);

/* ==================================================================== *
 *  Yordamchi funksiyalar
 * ==================================================================== */

const ID_PATTERN = '/^[a-f0-9]{10}$/';
const UPLOAD_ID_PATTERN = '/^[a-f0-9]{16}$/';
const ADMIN_REQUIRED = 'Bu amal uchun administrator sifatida kirish kerak.';

/** Ma'lumotlar papkasi. Imkon bo'lsa — veb-ildizdan tashqarida. */
function data_dir(): string
{
    static $resolved = null;
    if ($resolved !== null) {
        return $resolved;
    }
    foreach ([dirname(__DIR__) . '/data', __DIR__ . '/data'] as $candidate) {
        if (is_dir($candidate) || @mkdir($candidate, 0770, true)) {
            $resolved = $candidate;
            break;
        }
    }
    if ($resolved === null) {
        send_json(500, ['error' => "Ma'lumotlar papkasini yaratish imkoni bo'lmadi. Papka huquqlarini tekshiring."]);
    }
    // Papka veb-ildiz ichida bo'lsa — tashqaridan ochilishini bloklaymiz
    if (str_starts_with($resolved, __DIR__) && !file_exists($resolved . '/.htaccess')) {
        @file_put_contents($resolved . '/.htaccess', "Require all denied\nDeny from all\n");
    }
    foreach (['uploads', 'posters', 'tmp'] as $sub) {
        if (!is_dir($resolved . '/' . $sub)) {
            @mkdir($resolved . '/' . $sub, 0770, true);
        }
    }
    return $resolved;
}

function catalog_file(): string
{
    return data_dir() . '/videos.json';
}

function send_json(int $status, array $payload): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function send_text(int $status, string $text): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $text;
    exit;
}

/** Katalogni o'qiydi. */
function catalog_read(): array
{
    $file = catalog_file();
    if (!is_file($file)) {
        return [];
    }
    $raw = file_get_contents($file);
    $parsed = json_decode((string) $raw, true);
    return is_array($parsed['videos'] ?? null) ? $parsed['videos'] : [];
}

/**
 * Katalogni qulflab o'zgartiradi (parallel so'rovlar bir-birini buzmasligi uchun).
 * @param callable $mutator array $videos -> array [yangi ro'yxat, natija]
 */
function catalog_update(callable $mutator): mixed
{
    $file = catalog_file();
    $handle = fopen($file, 'c+');
    if ($handle === false) {
        send_json(500, ['error' => "Katalog faylini yozish imkoni bo'lmadi: " . basename($file)]);
    }
    flock($handle, LOCK_EX);
    $raw = stream_get_contents($handle);
    $parsed = json_decode((string) $raw, true);
    $videos = is_array($parsed['videos'] ?? null) ? $parsed['videos'] : [];

    [$videos, $result] = $mutator($videos);

    $body = json_encode(['videos' => $videos], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, (string) $body);
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    return $result;
}

function find_video(string $id): ?array
{
    foreach (catalog_read() as $video) {
        if (($video['id'] ?? '') === $id) {
            return $video;
        }
    }
    return null;
}

function clamp_text(mixed $value, int $max): string
{
    if (!is_string($value)) {
        return '';
    }
    $value = trim((string) preg_replace('/\s+/u', ' ', $value));
    return mb_substr($value, 0, $max);
}

function clamp_multiline(mixed $value, int $max): string
{
    if (!is_string($value)) {
        return '';
    }
    return mb_substr(trim(str_replace("\r\n", "\n", $value)), 0, $max);
}

const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'ogv', 'ogg', 'mov', 'mkv', 'mpeg', 'mpg', '3gp', 'avi'];

function extension_for(string $originalName, string $mimeType): string
{
    $fromName = strtolower((string) pathinfo($originalName, PATHINFO_EXTENSION));
    if (in_array($fromName, VIDEO_EXTENSIONS, true)) {
        return $fromName;
    }
    return match (strtolower(explode(';', $mimeType)[0])) {
        'video/webm' => 'webm',
        'video/ogg' => 'ogv',
        'video/quicktime' => 'mov',
        'video/x-matroska' => 'mkv',
        'video/x-m4v' => 'm4v',
        'video/mpeg' => 'mpeg',
        'video/3gpp' => '3gp',
        'video/x-msvideo' => 'avi',
        default => 'mp4',
    };
}

function mime_for_extension(string $extension): string
{
    return match ($extension) {
        'webm' => 'video/webm',
        'ogv', 'ogg' => 'video/ogg',
        'mov' => 'video/quicktime',
        'mkv' => 'video/x-matroska',
        'm4v' => 'video/x-m4v',
        'mpeg', 'mpg' => 'video/mpeg',
        '3gp' => 'video/3gpp',
        'avi' => 'video/x-msvideo',
        default => 'video/mp4',
    };
}

/* ==================================================================== *
 *  Administrator sessiyasi
 * ==================================================================== */

function request_is_https(): bool
{
    if (($_SERVER['HTTPS'] ?? '') && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }
    return strtolower(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]) === 'https';
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Strict',
        'secure' => request_is_https(),
    ]);
    session_name('video_arxiv_admin');
    @session_start();
}

function is_admin(): bool
{
    start_session();
    return ($_SESSION['admin'] ?? false) === true;
}

function require_admin(): void
{
    if (!is_admin()) {
        send_json(401, ['error' => ADMIN_REQUIRED]);
    }
}

function client_ip(): string
{
    $forwarded = trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''))[0]);
    return $forwarded !== '' ? $forwarded : (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

/** Parolni topishga urinishlarni cheklaydi: 15 daqiqada 10 marta. */
function login_attempts(bool $registerFailure = false): bool
{
    $file = data_dir() . '/attempts.json';
    $handle = fopen($file, 'c+');
    if ($handle === false) {
        return false;
    }
    flock($handle, LOCK_EX);
    $data = json_decode((string) stream_get_contents($handle), true);
    $data = is_array($data) ? $data : [];
    $now = time();
    $key = client_ip();

    // eskirgan yozuvlarni tozalash
    foreach ($data as $ip => $entry) {
        if (($entry['resetAt'] ?? 0) < $now) {
            unset($data[$ip]);
        }
    }
    $entry = $data[$key] ?? ['count' => 0, 'resetAt' => $now + 900];
    $blocked = $entry['count'] >= 10;

    if ($registerFailure && !$blocked) {
        $entry['count']++;
        $data[$key] = $entry;
    } elseif ($registerFailure) {
        $data[$key] = $entry;
    }

    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, (string) json_encode($data));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    return $blocked;
}

function clear_login_attempts(): void
{
    $file = data_dir() . '/attempts.json';
    $data = is_file($file) ? json_decode((string) file_get_contents($file), true) : [];
    if (is_array($data)) {
        unset($data[client_ip()]);
        @file_put_contents($file, json_encode($data));
    }
}

/* ==================================================================== *
 *  Fayl yuborish (Range qo'llab-quvvatlanadi)
 * ==================================================================== */

function serve_file(string $path, string $contentType, bool $allowRange): never
{
    if (!is_file($path)) {
        send_text(404, '404 — fayl topilmadi');
    }
    $size = (int) filesize($path);
    $start = 0;
    $end = $size - 1;
    $status = 200;

    $range = $_SERVER['HTTP_RANGE'] ?? '';
    if ($allowRange && preg_match('/^bytes=(\d*)-(\d*)$/', trim($range), $m) === 1) {
        if ($m[1] === '' && $m[2] === '') {
            http_response_code(416);
            header("Content-Range: bytes */$size");
            exit;
        }
        if ($m[1] === '') {
            $start = max(0, $size - (int) $m[2]);
        } else {
            $start = (int) $m[1];
            if ($m[2] !== '') {
                $end = min((int) $m[2], $size - 1);
            }
        }
        if ($start > $end || $start >= $size) {
            http_response_code(416);
            header("Content-Range: bytes */$size");
            exit;
        }
        $status = 206;
    }

    http_response_code($status);
    header('Content-Type: ' . $contentType);
    header('Content-Length: ' . (string) ($end - $start + 1));
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', (int) filemtime($path)) . ' GMT');
    if ($allowRange) {
        header('Accept-Ranges: bytes');
        header('Cache-Control: public, max-age=3600');
        if ($status === 206) {
            header("Content-Range: bytes $start-$end/$size");
        }
    } else {
        header('Cache-Control: public, max-age=600');
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
        exit;
    }

    // Katta fayllarni xotiraga yuklamasdan, bo'laklab uzatamiz
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    $handle = fopen($path, 'rb');
    if ($handle === false) {
        send_text(500, 'Faylni ochish imkoni bo\'lmadi');
    }
    fseek($handle, $start);
    $remaining = $end - $start + 1;
    while ($remaining > 0 && !feof($handle) && !connection_aborted()) {
        $buffer = fread($handle, (int) min(262144, $remaining));
        if ($buffer === false || $buffer === '') {
            break;
        }
        echo $buffer;
        flush();
        $remaining -= strlen($buffer);
    }
    fclose($handle);
    exit;
}

function serve_page(string $fileName): never
{
    $path = __DIR__ . '/' . $fileName;
    if (!is_file($path)) {
        send_text(404, '404 — sahifa topilmadi');
    }
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    readfile($path);
    exit;
}

/* ==================================================================== *
 *  So'rovni aniqlash
 * ==================================================================== */

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$path = '/' . ltrim(rawurldecode($path), '/');

// PHP'ning ichki serveri (`php -S`) uchun: mavjud statik fayllarni o'zi bersin
if (PHP_SAPI === 'cli-server') {
    $candidate = __DIR__ . $path;
    if ($path !== '/' && is_file($candidate) && !str_ends_with($candidate, '.php')) {
        return false;
    }
}

/* ==================================================================== *
 *  API — hammaga ochiq
 * ==================================================================== */

if ($path === '/api/config' && $method === 'GET') {
    send_json(200, [
        'publicBaseUrl' => rtrim($PUBLIC_BASE_URL, '/'),
        'maxUploadBytes' => $MAX_UPLOAD_BYTES,
        'uploadMode' => 'chunked',
        'chunkBytes' => $CHUNK_BYTES,
    ]);
}

if ($path === '/api/session' && $method === 'GET') {
    send_json(200, ['admin' => is_admin()]);
}

if ($path === '/api/login' && $method === 'POST') {
    $payload = json_decode((string) file_get_contents('php://input'), true);
    $candidate = is_array($payload) ? (string) ($payload['password'] ?? '') : '';
    if (login_attempts()) {
        send_json(429, ['error' => "Juda ko'p urinish. 15 daqiqadan so'ng qayta harakat qiling."]);
    }
    if ($candidate === '' || !hash_equals($ADMIN_PASSWORD, $candidate)) {
        login_attempts(true);
        send_json(401, ['error' => "Parol noto'g'ri."]);
    }
    clear_login_attempts();
    start_session();
    session_regenerate_id(true);
    $_SESSION['admin'] = true;
    send_json(200, ['admin' => true]);
}

if ($path === '/api/logout' && $method === 'POST') {
    start_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => $params['path'],
            'httponly' => true,
            'samesite' => 'Strict',
            'secure' => request_is_https(),
        ]);
    }
    @session_destroy();
    send_json(200, ['admin' => false]);
}

if ($path === '/api/videos' && $method === 'GET') {
    $videos = catalog_read();
    usort($videos, static fn(array $a, array $b): int => strcmp((string) ($b['createdAt'] ?? ''), (string) ($a['createdAt'] ?? '')));
    send_json(200, ['videos' => $videos]);
}

if (preg_match('#^/api/videos/([^/]+)$#', $path, $m) === 1 && $method === 'GET') {
    if (preg_match(ID_PATTERN, $m[1]) !== 1) {
        send_json(400, ['error' => "ID noto'g'ri"]);
    }
    $video = find_video($m[1]);
    $video ? send_json(200, ['video' => $video]) : send_json(404, ['error' => 'Video topilmadi']);
}

/* ==================================================================== *
 *  API — faqat administrator uchun: bo'laklab yuklash
 * ==================================================================== */

if ($path === '/api/uploads' && $method === 'POST') {
    require_admin();
    // Eskirgan (tugallanmagan) yuklashlarni tozalab qo'yamiz
    foreach ((array) glob(data_dir() . '/tmp/*') as $stale) {
        if (is_file($stale) && filemtime($stale) < time() - 86400) {
            @unlink($stale);
        }
    }
    $uploadId = bin2hex(random_bytes(8));
    if (file_put_contents(data_dir() . '/tmp/' . $uploadId, '') === false) {
        send_json(500, ['error' => "Vaqtinchalik fayl yaratilmadi. `data/tmp` papkasi huquqlarini tekshiring."]);
    }
    send_json(201, ['uploadId' => $uploadId, 'chunkBytes' => $CHUNK_BYTES]);
}

if (preg_match('#^/api/uploads/([^/]+)$#', $path, $m) === 1 && in_array($method, ['PUT', 'POST'], true)) {
    require_admin();
    if (preg_match(UPLOAD_ID_PATTERN, $m[1]) !== 1) {
        send_json(400, ['error' => "Yuklash ID'si noto'g'ri"]);
    }
    $tmpPath = data_dir() . '/tmp/' . $m[1];
    if (!is_file($tmpPath)) {
        send_json(404, ['error' => 'Yuklash topilmadi yoki muddati tugagan']);
    }
    $offset = (int) ($_GET['offset'] ?? -1);
    $current = (int) filesize($tmpPath);
    if ($offset !== $current) {
        // Mijoz noto'g'ri joydan yuborsa — qayerdan davom etishni aytamiz
        send_json(409, ['error' => 'Bo\'lak tartibi mos kelmadi', 'expectedOffset' => $current]);
    }

    $input = fopen('php://input', 'rb');
    $output = fopen($tmpPath, 'ab');
    if ($input === false || $output === false) {
        send_json(500, ['error' => "Bo'lakni saqlash imkoni bo'lmadi"]);
    }
    $written = 0;
    while (!feof($input)) {
        $buffer = fread($input, 262144);
        if ($buffer === false || $buffer === '') {
            break;
        }
        if ($current + $written + strlen($buffer) > $MAX_UPLOAD_BYTES) {
            fclose($input);
            fclose($output);
            @unlink($tmpPath);
            send_json(413, ['error' => 'Fayl hajmi chegaradan oshdi (' . (int) round($MAX_UPLOAD_BYTES / 1048576) . ' MB)']);
        }
        fwrite($output, $buffer);
        $written += strlen($buffer);
    }
    fclose($input);
    fclose($output);
    send_json(200, ['received' => $current + $written]);
}

if (preg_match('#^/api/uploads/([^/]+)/finish$#', $path, $m) === 1 && $method === 'POST') {
    require_admin();
    if (preg_match(UPLOAD_ID_PATTERN, $m[1]) !== 1) {
        send_json(400, ['error' => "Yuklash ID'si noto'g'ri"]);
    }
    $tmpPath = data_dir() . '/tmp/' . $m[1];
    if (!is_file($tmpPath)) {
        send_json(404, ['error' => 'Yuklash topilmadi yoki muddati tugagan']);
    }
    $size = (int) filesize($tmpPath);
    if ($size === 0) {
        @unlink($tmpPath);
        send_json(400, ['error' => "Bo'sh fayl yuborildi"]);
    }

    $meta = json_decode((string) file_get_contents('php://input'), true);
    $meta = is_array($meta) ? $meta : [];
    $title = clamp_text($meta['title'] ?? '', 200);
    if ($title === '') {
        send_json(400, ['error' => 'Video nomi kiritilishi shart']);
    }

    $originalName = clamp_text($meta['originalName'] ?? '', 260);
    $extension = extension_for($originalName, (string) ($meta['mimeType'] ?? ''));
    $id = bin2hex(random_bytes(5));
    $fileName = $id . '.' . $extension;
    if (!@rename($tmpPath, data_dir() . '/uploads/' . $fileName)) {
        send_json(500, ['error' => "Videoni saqlash imkoni bo'lmadi. `data/uploads` papkasi huquqlarini tekshiring."]);
    }

    $record = [
        'id' => $id,
        'title' => $title,
        'description' => clamp_multiline($meta['description'] ?? '', 4000),
        'district' => clamp_text($meta['district'] ?? '', 120),
        'cadastre' => clamp_text($meta['cadastre'] ?? '', 120),
        'area' => clamp_text($meta['area'] ?? '', 60),
        'location' => clamp_text($meta['location'] ?? '', 200),
        'originalName' => $originalName,
        'durationSeconds' => isset($meta['durationSeconds']) && is_numeric($meta['durationSeconds'])
            ? (int) round((float) $meta['durationSeconds']) : null,
        'fileName' => $fileName,
        'mimeType' => mime_for_extension($extension),
        'sizeBytes' => $size,
        'posterFile' => null,
        'createdAt' => gmdate('c'),
    ];
    catalog_update(static function (array $videos) use ($record): array {
        $videos[] = $record;
        return [$videos, null];
    });
    send_json(201, ['video' => $record]);
}

/* ==================================================================== *
 *  API — faqat administrator uchun: muqova, tahrirlash, o'chirish
 * ==================================================================== */

if (preg_match('#^/api/videos/([^/]+)/poster$#', $path, $m) === 1 && $method === 'POST') {
    require_admin();
    if (preg_match(ID_PATTERN, $m[1]) !== 1) {
        send_json(400, ['error' => "ID noto'g'ri"]);
    }
    $id = $m[1];
    if (find_video($id) === null) {
        send_json(404, ['error' => 'Video topilmadi']);
    }
    $body = (string) file_get_contents('php://input');
    if ($body === '' || strlen($body) > 4 * 1024 * 1024) {
        send_json(400, ['error' => "Muqova rasmi noto'g'ri hajmda"]);
    }
    $posterFile = $id . '.jpg';
    if (@file_put_contents(data_dir() . '/posters/' . $posterFile, $body) === false) {
        send_json(500, ['error' => "Muqovani saqlash imkoni bo'lmadi"]);
    }
    $updated = catalog_update(static function (array $videos) use ($id, $posterFile): array {
        foreach ($videos as $index => $video) {
            if (($video['id'] ?? '') === $id) {
                $videos[$index]['posterFile'] = $posterFile;
                return [$videos, $videos[$index]];
            }
        }
        return [$videos, null];
    });
    send_json(200, ['video' => $updated]);
}

if (preg_match('#^/api/videos/([^/]+)$#', $path, $m) === 1 && in_array($method, ['PATCH', 'PUT'], true)) {
    require_admin();
    if (preg_match(ID_PATTERN, $m[1]) !== 1) {
        send_json(400, ['error' => "ID noto'g'ri"]);
    }
    $id = $m[1];
    $payload = json_decode((string) file_get_contents('php://input'), true);
    $payload = is_array($payload) ? $payload : [];
    $patch = [];
    if (array_key_exists('title', $payload)) {
        $title = clamp_text($payload['title'], 200);
        if ($title === '') {
            send_json(400, ['error' => "Video nomi bo'sh bo'lishi mumkin emas"]);
        }
        $patch['title'] = $title;
    }
    foreach (['description' => 4000, 'district' => 120, 'cadastre' => 120, 'area' => 60, 'location' => 200] as $field => $max) {
        if (array_key_exists($field, $payload)) {
            $patch[$field] = $field === 'description'
                ? clamp_multiline($payload[$field], $max)
                : clamp_text($payload[$field], $max);
        }
    }
    $updated = catalog_update(static function (array $videos) use ($id, $patch): array {
        foreach ($videos as $index => $video) {
            if (($video['id'] ?? '') === $id) {
                $videos[$index] = array_merge($video, $patch);
                return [$videos, $videos[$index]];
            }
        }
        return [$videos, null];
    });
    $updated === null ? send_json(404, ['error' => 'Video topilmadi']) : send_json(200, ['video' => $updated]);
}

if (preg_match('#^/api/videos/([^/]+)$#', $path, $m) === 1 && $method === 'DELETE') {
    require_admin();
    if (preg_match(ID_PATTERN, $m[1]) !== 1) {
        send_json(400, ['error' => "ID noto'g'ri"]);
    }
    $id = $m[1];
    $removed = catalog_update(static function (array $videos) use ($id): array {
        foreach ($videos as $index => $video) {
            if (($video['id'] ?? '') === $id) {
                $removedVideo = $video;
                array_splice($videos, $index, 1);
                return [$videos, $removedVideo];
            }
        }
        return [$videos, null];
    });
    if ($removed === null) {
        send_json(404, ['error' => 'Video topilmadi']);
    }
    @unlink(data_dir() . '/uploads/' . ($removed['fileName'] ?? ''));
    if (!empty($removed['posterFile'])) {
        @unlink(data_dir() . '/posters/' . $removed['posterFile']);
    }
    send_json(200, ['deleted' => $id]);
}

/* ==================================================================== *
 *  Media — hammaga ochiq
 * ==================================================================== */

if (preg_match('#^/media/([^/]+)$#', $path, $m) === 1 && in_array($method, ['GET', 'HEAD'], true)) {
    $id = (string) preg_replace('/\.[a-z0-9]+$/i', '', $m[1]);
    if (preg_match(ID_PATTERN, $id) !== 1) {
        send_text(400, "ID noto'g'ri");
    }
    $video = find_video($id);
    if ($video === null) {
        send_text(404, '404 — video topilmadi');
    }
    serve_file(data_dir() . '/uploads/' . $video['fileName'], (string) ($video['mimeType'] ?? 'video/mp4'), true);
}

if (preg_match('#^/poster/([^/]+)$#', $path, $m) === 1 && in_array($method, ['GET', 'HEAD'], true)) {
    $id = (string) preg_replace('/\.[a-z0-9]+$/i', '', $m[1]);
    if (preg_match(ID_PATTERN, $id) !== 1) {
        send_text(400, "ID noto'g'ri");
    }
    $video = find_video($id);
    if ($video === null || empty($video['posterFile'])) {
        send_text(404, '404 — rasm topilmadi');
    }
    serve_file(data_dir() . '/posters/' . $video['posterFile'], 'image/jpeg', false);
}

/* ==================================================================== *
 *  Sahifalar
 * ==================================================================== */

if (in_array($method, ['GET', 'HEAD'], true)) {
    if ($path === '/' || $path === '/index.html' || $path === '/index.php') {
        serve_page('index.html');
    }
    if ($path === '/video.html' || preg_match('#^/v/[^/]+$#', $path) === 1) {
        serve_page('video.html');
    }
}

send_text(404, '404 — sahifa topilmadi');
