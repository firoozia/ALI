package com.padcod.cutclick.Utils;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.util.Base64;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.lang.reflect.Method;
import java.security.KeyStore;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSession;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/** Security and robustness fixes patched into CutClick 4.0.1. */
public final class Fix {
    private static final String SMS_SEND_PERMISSION = "com.google.android.gms.auth.api.phone.permission.SEND";
    private static final String FILE_PROVIDER_AUTHORITY = "com.padcod.cutclick.provider";
    private static final String[] EXTRA_ROOTS = {"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"};

    private static X509TrustManager systemTm;
    private static X509TrustManager extraTm;

    private Fix() {}

    // C2: only delete inside Download/CutClick/, never the base folder or anything outside it.
    public static void deleteProjectDir(String title) {
        try {
            if (title == null || title.trim().length() == 0) return;
            File base = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "CutClick");
            File target = new File(base, title.trim());
            String basePath = base.getCanonicalPath() + File.separator;
            if (!target.getCanonicalPath().startsWith(basePath)) return;
            deleteRecursive(target, basePath);
        } catch (Exception ignored) {
        }
    }

    private static void deleteRecursive(File f, String basePath) throws Exception {
        if (!f.getCanonicalPath().startsWith(basePath)) return;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File c : children) deleteRecursive(c, basePath);
            }
        }
        f.delete();
    }

    // H1: reject zip entries that would escape the extraction folder (ZipException is caught by the callers' IOException handlers).
    public static String zipEntry(String name) throws java.util.zip.ZipException {
        if (name == null) return null;
        String n = name.replace('\\', '/');
        if (n.startsWith("/") || n.equals("..") || n.startsWith("../") || n.contains("/../") || n.endsWith("/..")) {
            throw new java.util.zip.ZipException("Blocked unsafe zip entry: " + name);
        }
        return name;
    }

    // H2: real certificate validation (system CAs + bundled ISRG roots for old Android).
    public static void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
        initTrust();
        if (systemTm == null && extraTm == null) throw new CertificateException("No trust managers");
        CertificateException first = null;
        if (systemTm != null) {
            try {
                systemTm.checkServerTrusted(chain, authType);
                return;
            } catch (CertificateException e) {
                first = e;
            }
        }
        if (extraTm != null) {
            extraTm.checkServerTrusted(chain, authType);
            return;
        }
        throw first;
    }

    public static X509Certificate[] acceptedIssuers() {
        initTrust();
        ArrayList<X509Certificate> all = new ArrayList<X509Certificate>();
        if (systemTm != null) for (X509Certificate c : systemTm.getAcceptedIssuers()) all.add(c);
        if (extraTm != null) for (X509Certificate c : extraTm.getAcceptedIssuers()) all.add(c);
        return all.toArray(new X509Certificate[0]);
    }

    public static boolean verifyHost(String host, SSLSession session) {
        return HttpsURLConnection.getDefaultHostnameVerifier().verify(host, session);
    }

    private static synchronized void initTrust() {
        if (systemTm != null || extraTm != null) return;
        try {
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init((KeyStore) null);
            systemTm = firstX509(tmf.getTrustManagers());
        } catch (Exception ignored) {
        }
        try {
            KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
            ks.load(null, null);
            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            for (int i = 0; i < EXTRA_ROOTS.length; i++) {
                byte[] der = Base64.decode(EXTRA_ROOTS[i], Base64.DEFAULT);
                ks.setCertificateEntry("root" + i, cf.generateCertificate(new ByteArrayInputStream(der)));
            }
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(ks);
            extraTm = firstX509(tmf.getTrustManagers());
        } catch (Exception ignored) {
        }
    }

    private static X509TrustManager firstX509(TrustManager[] tms) {
        for (TrustManager tm : tms) if (tm instanceof X509TrustManager) return (X509TrustManager) tm;
        return null;
    }

    // M2: only Google Play services may deliver SMS_RETRIEVED.
    public static void registerSms(Context ctx, BroadcastReceiver receiver, IntentFilter filter) {
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                Method m = Context.class.getMethod("registerReceiver", BroadcastReceiver.class, IntentFilter.class,
                        String.class, Handler.class, int.class);
                int flags = Build.VERSION.SDK_INT >= 33 ? 2 /* RECEIVER_EXPORTED */ : 0;
                m.invoke(ctx, receiver, filter, SMS_SEND_PERMISSION, null, flags);
                return;
            } catch (Exception ignored) {
            }
        }
        ctx.registerReceiver(receiver, filter, SMS_SEND_PERMISSION, null);
    }

    public static String otp(String sms) {
        if (sms == null) return "";
        Matcher m = Pattern.compile("(?<!\\d)\\d{4,6}(?!\\d)").matcher(sms);
        if (m.find()) return m.group();
        String t = sms.trim();
        return t.length() > 5 ? t.substring(0, 5).trim() : t;
    }

    // M7: escape quotes in SQL string literals.
    public static String sqlLike(String s) {
        return s == null ? "" : s.replace("'", "''");
    }

    // M6: money values may exceed int and may be malformed.
    public static Long money(String s) {
        if (s == null) return Long.valueOf(0L);
        String t = s.replace(",", "").replace("٬", "").trim();
        try {
            return Long.valueOf(Long.parseLong(t));
        } catch (Exception e) {
            try {
                return Long.valueOf(Math.round(Double.parseDouble(t)));
            } catch (Exception e2) {
                return Long.valueOf(0L);
            }
        }
    }

    public static int parseIntSafe(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (Exception e) {
            return 0;
        }
    }

    // L1: share PDFs through the FileProvider instead of a raw file path.
    public static Uri pdfUri(Context ctx, Intent intent, String path) {
        File f = new File(path);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            Uri u = androidx.core.content.FileProvider.d(ctx, FILE_PROVIDER_AUTHORITY, f);
            if (u != null) return u;
        } catch (Throwable ignored) {
        }
        return Uri.fromFile(f);
    }
}
