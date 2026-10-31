package com.dreylus.pixelwars;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;

/** Methods exposed to the game as window.PixelWarsNative. */
final class NativeBridge {
    private final MainActivity activity;
    private final Haptics haptics;

    NativeBridge(MainActivity activity) {
        this.activity = activity;
        this.haptics = new Haptics(activity);
    }

    @JavascriptInterface
    public void haptic(String name, float strength) {
        haptics.play(name, strength);
    }

    @JavascriptInterface
    public void hapticPattern(String json) {
        // Reserved for future custom patterns; play a neutral tick for now.
        haptics.play("tick", 0.5f);
    }

    @JavascriptInterface
    public boolean hasRichHaptics() {
        return haptics.isRich();
    }

    @JavascriptInterface
    public void shareText(String text, String title) {
        activity.runOnUiThread(() -> {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            safeStart(Intent.createChooser(send, title));
        });
    }

    private static String cleanName(String filename) {
        String n = filename == null ? "pixelwars" : filename.replaceAll("[^A-Za-z0-9._-]", "_");
        return n.isEmpty() ? "pixelwars" : n;
    }

    @JavascriptInterface
    public void shareFile(String base64, String mime, String filename, String text) {
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            File dir = new File(activity.getCacheDir(), "shared");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File f = new File(dir, cleanName(filename));
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(bytes);
            }
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", f);
            activity.runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
                send.setClipData(ClipData.newRawUri("", uri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                safeStart(Intent.createChooser(send, "Share"));
            });
        } catch (Exception e) {
            activity.toast("Could not share: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public boolean saveToGallery(String base64, String mime, String filename) {
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            String name = cleanName(filename);
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = activity.getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/PixelWars");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) return false;
                try (OutputStream out = cr.openOutputStream(uri)) {
                    if (out == null) return false;
                    out.write(bytes);
                }
                v.clear();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                return true;
            }
            // Android 8-9: app pictures folder, no storage permission needed.
            File dir = activity.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
            if (dir == null) return false;
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File f = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(bytes);
            }
            MediaScannerConnection.scanFile(activity, new String[]{f.getAbsolutePath()}, new String[]{mime}, null);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public void copyText(String text) {
        activity.runOnUiThread(() -> {
            ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Pixel Wars", text));
        });
    }

    @JavascriptInterface
    public String readClipboard() {
        FutureTask<String> task = new FutureTask<>(() -> {
            ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null || !cm.hasPrimaryClip() || cm.getPrimaryClip() == null) return "";
            ClipData clip = cm.getPrimaryClip();
            if (clip.getItemCount() == 0) return "";
            CharSequence t = clip.getItemAt(0).coerceToText(activity);
            return t == null ? "" : t.toString();
        });
        activity.runOnUiThread(task);
        try {
            return task.get(2, TimeUnit.SECONDS);
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public void keepAwake(boolean on) {
        activity.runOnUiThread(() -> activity.setKeepAwake(on));
    }

    @JavascriptInterface
    public void setImmersive(boolean on) {
        activity.runOnUiThread(() -> activity.setGameFullscreen(on));
    }

    @JavascriptInterface
    public void setHighRefresh(boolean on) {
        activity.runOnUiThread(() -> activity.applyHighRefresh(on));
    }

    @JavascriptInterface
    public void exitApp() {
        activity.runOnUiThread(activity::finish);
    }

    @JavascriptInterface
    public String appVersion() {
        try {
            PackageInfo p = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return "android " + p.versionName;
        } catch (Exception e) {
            return "android";
        }
    }

    private void safeStart(Intent i) {
        try {
            activity.startActivity(i);
        } catch (Exception e) {
            activity.toast("No app can handle that");
        }
    }
}
