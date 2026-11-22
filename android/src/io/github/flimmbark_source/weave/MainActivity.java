package io.github.flimmbark_source.weave;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintManager;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Weave in a WebView. The page, the API and the PostgreSQL database (PGlite) run inside the WebView from
 * files in the APK (assets/www), and the data stays in the WebView storage of this app.
 * The code uses only APIs up to Android 6 (API 23), so it also builds against older android.jar files.
 */
public class MainActivity extends Activity {
    // The bundled files are served on this https host, which Android reserves for app assets, so IndexedDB,
    // Web Workers and WebAssembly behave as on the web. The data is stored per host: do not change it.
    private static final String HOST = "appassets.androidplatform.net";
    private static final int PICK_FILE = 1, SAVE_FILE = 2, PICK_ARCHIVE = 3;
    // Largest file handed to the page for an archive entry (it travels to the page as base64).
    private static final int MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
    private static final int LIGHT_NAVIGATION_BAR = 0x10; // View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR (API 26)

    private WebView web;
    private ValueCallback<Uri[]> picking;
    private byte[] saving;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F5F7F2"));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.addJavascriptInterface(new Bridge(), "WeaveAndroid");

        // The window draws behind the system bars (Android 15 always does). The padding keeps the page
        // clear of the bars and, with adjustResize, of the keyboard.
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#FFFEFA"));
        root.addView(web);
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets.consumeSystemWindowInsets();
            }
        });
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) flags |= LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(flags);
        setContentView(root);

        web.loadUrl("https://" + HOST + "/index.html");
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // An open dialog or insight capture closes first (both close on Escape). Then the page goes back.
        web.evaluateJavascript("(function(){if(!document.querySelector('.modal-back,[data-back-closes]'))return false;"
                + "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return true})()", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String closedDialog) {
                if ("true".equals(closedDialog)) return;
                if (web.canGoBack()) web.goBack();
                else MainActivity.super.onBackPressed();
            }
        });
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        if (request == PICK_ARCHIVE) {
            archivePicked(uri);
            return;
        }
        if (request == PICK_FILE && picking != null) {
            picking.onReceiveValue(uri == null ? null : new Uri[] { uri });
            picking = null;
        } else if (request == SAVE_FILE && saving != null) {
            byte[] bytes = saving;
            saving = null;
            if (uri == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                out.write(bytes);
                toast("Saved");
            } catch (IOException | RuntimeException e) {
                toast("The file could not be saved.");
            }
        }
    }

    /**
     * An archive file: the app keeps permission to open it again (from the phone or a cloud app such as Drive),
     * reads it once for the page, and stores only its address. The file itself is never copied into the app.
     */
    private void archivePicked(Uri uri) {
        JSONObject out = new JSONObject();
        try {
            if (uri == null) { deliver("null"); return; }
            try {
                getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                out.put("lasting", true);
            } catch (SecurityException e) {
                out.put("lasting", false); // the app that holds the file does not allow opening it later
            }
            String name = "file";
            long size = -1;
            try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME), z = c.getColumnIndex(OpenableColumns.SIZE);
                    if (n >= 0 && !c.isNull(n)) name = c.getString(n);
                    if (z >= 0 && !c.isNull(z)) size = c.getLong(z);
                }
            }
            if (size > MAX_ARCHIVE_BYTES) { out.put("error", "This file is larger than 25 MB."); deliver(out.toString()); return; }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IOException("no stream");
                byte[] buf = new byte[65536];
                for (int r; (r = in.read(buf)) > 0; ) {
                    bytes.write(buf, 0, r);
                    if (bytes.size() > MAX_ARCHIVE_BYTES) { out.put("error", "This file is larger than 25 MB."); deliver(out.toString()); return; }
                }
            }
            String mime = getContentResolver().getType(uri);
            out.put("name", name).put("mime", mime == null ? "" : mime).put("size", bytes.size()).put("ref", uri.toString())
                .put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
            deliver(out.toString());
        } catch (IOException | RuntimeException | JSONException e) {
            deliver("{\"error\":\"The file could not be read.\"}");
        }
    }

    private void deliver(String json) {
        web.evaluateJavascript("window.weaveFilePicked && window.weaveFilePicked(" + json + ")", null);
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }

    private static String mimeType(String path) {
        switch (path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT)) {
            case "html": return "text/html";
            case "js": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "wasm": return "application/wasm";
            case "ttf": return "font/ttf";
            case "gz": return "application/gzip";
            default: return "application/octet-stream";
        }
    }

    /** Serves the bundled files and opens every other address in the browser. */
    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!HOST.equals(url.getHost())) return null;
            String path = url.getPath() == null || url.getPath().equals("/") ? "/index.html" : url.getPath();
            String type = mimeType(path);
            String charset = type.startsWith("text/") || type.equals("application/json") ? "utf-8" : null;
            try {
                InputStream in = getAssets().open("www" + path);
                return new WebResourceResponse(type, charset, 200, "OK", null, in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
            }
        }

        // The variant with a WebResourceRequest is API 24. Android also calls this one there.
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (HOST.equals(uri.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException e) {
                toast("No app on this phone can open that link.");
            }
            return true;
        }
    }

    /** File inputs in the page (imports) open the system file picker. */
    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (picking != null) picking.onReceiveValue(null);
            picking = callback;
            try {
                startActivityForResult(new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), PICK_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                picking = null;
                toast("No app on this phone can pick files.");
                return false;
            }
        }
    }

    /** window.WeaveAndroid in the page. A WebView cannot download files, so the page hands them over here. */
    private class Bridge {
        @JavascriptInterface
        public void saveFile(final String name, String type, String base64) {
            final byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            final String mime = type.contains(";") ? type.substring(0, type.indexOf(';')).trim() : type;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    saving = bytes;
                    try {
                        startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, name), SAVE_FILE);
                    } catch (ActivityNotFoundException e) {
                        saving = null;
                        toast("No app on this phone can save files.");
                    }
                }
            });
        }

        /** Opens the system picker for an archive file; the result arrives in window.weaveFilePicked. */
        @JavascriptInterface
        public void pickFile() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    try {
                        startActivityForResult(pick, PICK_ARCHIVE);
                    } catch (ActivityNotFoundException e) {
                        toast("No app on this phone can pick files.");
                        deliver("null");
                    }
                }
            });
        }

        /** Opens an archived file again in the app that handles it, from where it was picked. */
        @JavascriptInterface
        public void openFile(final String ref, final String mime) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(ref), mime == null || mime.isEmpty() ? "*/*" : mime)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(view);
                    } catch (ActivityNotFoundException e) {
                        toast("No app on this phone can open this kind of file.");
                    } catch (SecurityException e) {
                        toast("This file can no longer be opened from here. Add it again.");
                    }
                }
            });
        }

        @JavascriptInterface
        public void print() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    PrintManager printer = (PrintManager) getSystemService(PRINT_SERVICE);
                    printer.print("Weave", web.createPrintDocumentAdapter("Weave"), null);
                }
            });
        }
    }
}
