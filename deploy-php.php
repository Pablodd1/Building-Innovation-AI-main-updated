<?php
/**
 * Deploy helper: copies uploaded files from public_html to nodejs/
 * Access via: https://buildingapp.us/deploy-php.php?run=1
 */

$targetDir = '/home/u496083892/domains/buildingapp.us/nodejs';
$sourceDir = '/home/u496083892/domains/buildingapp.us/public_html';

header('Content-Type: text/plain');

if (!isset($_GET['run'])) {
    echo "Add ?run=1 to execute deployment\n";
    echo "Options: &step=upload|copy|restart|all (default: all)\n";
    exit;
}

$step = $_GET['step'] ?? 'all';

function recurse_copy($src, $dst) {
    $dir = opendir($src);
    if (!is_dir($dst)) mkdir($dst, 0755, true);
    while (($file = readdir($dir)) !== false) {
        if ($file == '.' || $file == '..') continue;
        $srcFile = "$src/$file";
        $dstFile = "$dst/$file";
        if (is_dir($srcFile)) {
            recurse_copy($srcFile, $dstFile);
        } else {
            copy($srcFile, $dstFile);
            echo "  COPIED: $dstFile\n";
        }
    }
    closedir($dir);
}

function recurse_delete($dir) {
    if (!is_dir($dir)) return;
    $items = scandir($dir);
    foreach ($items as $item) {
        if ($item == '.' || $item == '..') continue;
        $path = "$dir/$item";
        if (is_dir($path)) {
            recurse_delete($path);
        } else {
            unlink($path);
        }
    }
    rmdir($dir);
}

// STEP: upload (list what's in public_html staging area)
if ($step == 'upload' || $step == 'all') {
    echo "=== Files in public_html (staging) ===\n";
    $files = scandir($sourceDir);
    foreach ($files as $f) {
        if ($f == '.' || $f == '..') continue;
        if (in_array($f, ['.htaccess', '.builds', 'deploy-php.php', 'test.php'])) continue;
        echo "  $f\n";
    }
}

// STEP: copy to nodejs/
if ($step == 'copy' || $step == 'all') {
    echo "\n=== Copying to nodejs/ ===\n";
    
    // Remove old dist and dist-server in nodejs
    foreach (['dist', 'dist-server'] as $folder) {
        $oldPath = "$targetDir/$folder";
        if (is_dir($oldPath)) {
            echo "Removing old $folder...\n";
            recurse_delete($oldPath);
        }
    }
    
    // Copy dist
    $srcDist = "$sourceDir/dist";
    $dstDist = "$targetDir/dist";
    if (is_dir($srcDist)) {
        echo "Copying dist/ ...\n";
        recurse_copy($srcDist, $dstDist);
        echo "dist/ copied successfully\n";
    } else {
        echo "WARNING: dist/ not found in public_html\n";
    }
    
    // Copy dist-server
    $srcServer = "$sourceDir/dist-server";
    $dstServer = "$targetDir/dist-server";
    if (is_dir($srcServer)) {
        echo "Copying dist-server/ ...\n";
        recurse_copy($srcServer, $dstServer);
        echo "dist-server/ copied successfully\n";
    } else {
        echo "WARNING: dist-server/ not found in public_html\n";
    }
    
    // Copy individual files that might be at root
    foreach (scandir($sourceDir) as $f) {
        if ($f == '.' || $f == '..') continue;
        if (in_array($f, ['.htaccess', '.builds', 'deploy-php.php', 'test.php'])) continue;
        if ($f == 'dist' || $f == 'dist-server') continue;
        $srcFile = "$sourceDir/$f";
        $dstFile = "$targetDir/$f";
        if (is_file($srcFile)) {
            copy($srcFile, $dstFile);
            echo "  COPIED: $f\n";
        }
    }
}

// STEP: restart Passenger
if ($step == 'restart' || $step == 'all') {
    echo "\n=== Restarting Passenger ===\n";
    $restartFile = "$targetDir/tmp/restart.txt";
    $restartDir = dirname($restartFile);
    if (!is_dir($restartDir)) mkdir($restartDir, 0755, true);
    file_put_contents($restartFile, date('Y-m-d H:i:s') . " deploy\n");
    echo "Touched: $restartFile\n";
    echo "Passenger will restart shortly.\n";
}

echo "\n=== DONE ===\n";
