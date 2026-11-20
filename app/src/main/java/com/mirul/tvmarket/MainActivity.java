package com.mirul.tvmarket;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Pastikan scroll menegak halaman (panel SCALP panjang) berfungsi dalam WebView.
        web.setVerticalScrollBarEnabled(true);
        web.setOverScrollMode(View.OVER_SCROLL_ALWAYS);
        web.setScrollbarFadingEnabled(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req,
                                        WebResourceError err) {
                // Hanya papar error utama document, bukan subresource kecil
                if (req.isForMainFrame()) {
                    showDiag("load gagal: " + err.getDescription());
                }
            }
        });

        // Console + JS exception dipapar terus ke skrin — supaya kalau UI
        // blank, punca sebenar kelihatan dalam screenshot seterusnya.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                if ("ERROR".equals(m.messageLevel().name()) || "WARNING".equals(m.messageLevel().name())) {
                    showDiag(m.messageLevel() + ": " + m.message()
                            + " @" + m.sourceId() + ":" + m.lineNumber());
                }
                return true;
            }
        });

        web.setBackgroundColor(0xFF0A0C10);
        setContentView(web);
        web.loadUrl("file:///android_asset/web/index.html");
    }

    // Suntik banner ralat ke DOM WebView (jika JS jalan) atau guna alert-style
    private void showDiag(final String msg) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
            if (web == null) return;
            String safe = msg.replace("\\", "\\\\").replace("'", "\\'")
                    .replace("\n", " ").replace("\r", "");
            String js = "(function(){var d=document.getElementById('__diag');"
                    + "if(!d){d=document.createElement('div');d.id='__diag';"
                    + "d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;"
                    + "background:#b00020;color:#fff;font:12px monospace;padding:6px;"
                    + "white-space:pre-wrap;word-break:break-all;max-height:50%;overflow:auto';"
                    + "document.body?document.body.appendChild(d):document.addEventListener("
                    + "'DOMContentLoaded',function(){document.body.appendChild(d)});}"
                    + "d.textContent='" + safe + "\\n' + d.textContent;})();";
            web.evaluateJavascript(js, null);
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
