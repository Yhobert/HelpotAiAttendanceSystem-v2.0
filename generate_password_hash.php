<?php
/**
 * Password Hash Generator
 * 
 * Use this script to generate password hashes for the database.
 * Run this from command line: php generate_password_hash.php
 * Or access via browser: http://localhost/att.System/generate_password_hash.php
 * 
 * SECURITY: Delete this file after use in production!
 */

// Get password from command line argument or use default
$password = isset($argv[1]) ? $argv[1] : (isset($_GET['password']) ? $_GET['password'] : 'admin123');

// Generate hash
$hash = password_hash($password, PASSWORD_DEFAULT);

// Output
if (php_sapi_name() === 'cli') {
    echo "Password: $password\n";
    echo "Hash: $hash\n";
    echo "\nSQL to insert/update user:\n";
    echo "UPDATE users SET password = '$hash' WHERE username = 'admin';\n";
    echo "OR\n";
    echo "INSERT INTO users (username, password, role) VALUES ('admin', '$hash', 'admin');\n";
} else {
    header('Content-Type: text/plain');
    echo "Password: $password\n";
    echo "Hash: $hash\n";
    echo "\nSQL to insert/update user:\n";
    echo "UPDATE users SET password = '$hash' WHERE username = 'admin';\n";
    echo "OR\n";
    echo "INSERT INTO users (username, password, role) VALUES ('admin', '$hash', 'admin');\n";
    echo "\n⚠️ SECURITY WARNING: Delete this file after use!\n";
}
?>


