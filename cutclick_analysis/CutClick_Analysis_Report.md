# CutClick 4.0.1 (versionCode 27, com.padcod.cutclick): security and quality audit

Paths are relative to these roots:
- `src/` = `scratchpad/apk_src/sources` (jadx output)
- `dec/` = `scratchpad/apk_dec` (apktool output)

Line numbers are jadx line numbers. Decompiled control flow was cross-checked against smali where a finding depended on it. Two jadx artifacts that look like bugs but are not are listed at the end, so nobody "fixes" them.

---

## Executive summary

The app has no client-side authentication beyond a numeric `user_id` kept in SharedPreferences, plus one static API key that is hardcoded and the same for every install. Every endpoint takes `user_id` or `project_id` as a plain parameter. If the server does not tie the per-user `user_token` to that `user_id`, anyone can read, modify or delete any user's data. This needs server-side confirmation, but the client design strongly suggests the risk is real.

Two client-side bugs can destroy data:

1. **Recursive delete with a path taken from the project title.** The title can come from the server, including cloud projects that another user shares with you. The app holds `MANAGE_EXTERNAL_STORAGE`, so a title such as `../..` deletes all of shared storage.
2. **The SQLite `onUpgrade` drops every project table.** Any schema bump wipes all local projects. Projects are backed up to the cloud only on the direct-link update path.

Also confirmed:

- Zip extraction allows path traversal (Zip Slip), and the code calls `ZipPathValidator.clearCallback()`, which explicitly turns off the protection Android 14 adds.
- On Android 7.0 and below the app trusts every TLS certificate and hostname, and downloads the assets ZIP over plain HTTP.
- Several components are exported without protection.
- The SMS-retriever receiver is exported and crash-prone.
- Location permissions are declared but never used.
- There are many crash risks: `parseInt` on server data, `split()[1]`, UI work on background threads.
- There is a large maintainability problem: a 14.7k-line activity, a 45.7k-line generated-style fragment, and 1,064 hardcoded Persian literals in code.

There is **no** signature, integrity, root or anti-tamper check. Re-signing works, but it has side effects; see §Q1.

### Quick answers

**Q1. Signature, integrity and anti-tamper checks: none.**
- No root checks, no debugger checks, no installer checks, no Play Integrity or SafetyNet, no certificate pinning.
- The only code that reads the app's own signature is `S3/b.java` (the standard Google `AppSignatureHelper`), called in `MainActivity.java:358-370`. It only computes and **logs** the 11-character SMS-Retriever hash (`Log.i("AAA","onCreate: "+hash)`). Nothing is enforced.
- Other `signatures` hits are library code (GMS `T1/e.java`, `T1/g.java`; AndroidX fonts `M/d.java`; `L2/e.java`). `getInstallerPackageName` appears only in Firebase's user-agent code (`J1/i.java:299`).
- `MyKeyboard.getMiddlePart2()` returns `"ca00ec56eeb"` (11 characters, looks like an SMS app hash), but nothing uses it.

Effects of re-signing:
- (a) The SMS-Retriever hash changes, so OTP auto-fill stops working because the server's SMS contains the old hash. Users have to type the code by hand.
- (b) The official update APK cannot be installed over a re-signed one, and the reverse is also true (signature mismatch).
- (c) The update check is hardcoded to `27` (see M9). If the server's `version` is greater than 27, a **non-cancelable** forced-update dialog appears whenever `is_force_update=1`.
- (d) `google_app_id` and the FCM sender stay valid, because Firebase does not check the signer for FCM.

**Q2. Server base URLs (all HTTPS in code):**
- `https://kargah.pad-design.ir/api/v2/`: main API (`T3/d.java:61`) and cloud API (`U3/a.java:60`)
- `https://admin.pad-design.ir/`: forms and exports (`W3/a.java:23`); also WebView pages `projectFactorCardexView/…`, `projectPlatesPartsUserView/…`, `projectPlatesPartsView/…`, and `api/v1/paymentCutClick/{planId}/{userId}` (`H3/ViewOnClickListenerC0023a.java:205`)
- `https://pad-design.ir/`: `V3.c` client (`Activity/C0306i.java:98`); wallet top-up `https://pad-design.ir/multiPay?user_id=…&price=…&app=cutclick` (`O3/f0.java:123,152`)
- `https://kabinetplus.ir/terms` (`LoginActivity.java:159`), `http://instagram.com/padcod/` (`O3/L.java:78`, `H3/B.java:190`)
- Firebase project `cut-click` (sender 361412632631)
- URLs the server supplies at runtime: the assets ZIP URL (rewritten to `http://` on API ≤ 24, `Activity/q.java:205-206`), slider links, `direct_link`, `bazar_link`, `myket_link`, `playstore_link`, `app_rule_url`, export links

**Q3. Persian literals that are logic or data, not just labels.** See the dedicated section at the end. In short:
- `"خدماتی"` and `"گالری"` are **navigation-state keys.** The toolbar title text is compared with `equals()` and `switch`.
- `"همرنگ"` and `"سفید"` are **written into the PVC color field, stored in the DB and sent to the server** (`ProjectPlateSendData.color`).
- `"ندارد"` is compared with `equals()` against TextView text, and against **stored color data**.
- `"ساده"`, `"شیاری"` and `"راه‌دار"` (in code as `"راه‌دار"`) are **display-only.** They are derived from ints (`getType().equals("1")`, `getAssemble_type()==0`), but they end up inside the generated cutting-map PDF text.

---

## CRITICAL

### C1. Identity is a client-supplied `user_id`, and the API key is static and hardcoded (IDOR / impersonation; needs server-side confirmation)

**Where:**
- `src/T3/a.java:33-38` (same code in `V3/a.java:22-27`)
- `src/com/padcod/cutclick/Utils/A.java:84-87`
- `src/R4/D.java:24-27`
- `src/T3/e.java` (all methods), `src/U3/b.java`, `src/W3/b.java`

```java
StringBuilder sb = new StringBuilder("RGhxZWMwdG5FT0c3dk01d2JEeVV3YkR5VTJl...");
sb.append(MyKeyboard.getMiddlePart());          // middle part hidden in CustomView/MyKeyboard.java:89
sb.append("wdG5FT0c3dk01d2JEeVUyZWMwakVhelZkUERocWVj...");
a6.a(A.h(context, sb.toString()));              // header "api_key" = user_token, or the static key if none
// A.h(): returns prefs "user_token" if present, else the static key
```
```java
@GET("getUser")              Call<UserResponse> v(@Query("user_id") int);
@GET("getPayments")          Call<PaymentResponse> b(@Query("user_id") int, ...);
@GET("getProjectDataJson")   Call<...> B(@Query("project_id") int);            // no user_id at all
@DELETE("deleteCloudProject") Call<ServerResponse> a(@Query("project_id") int); // U3/b.java:18
@GET("getCloudProjectDetail") Call<...> c(@Query("project_id") int);            // U3/b.java:24
@FormUrlEncoded @POST("verify") Call<UserResponse> a(@Field("user_id") int, @Field("verify") String);
```

**What's wrong:**
- The session is just `user_id` in default SharedPreferences. `SplashScreenActivity.t()` calls `getUser(user_id)`, and the app logs straight in when the call succeeds.
- Before login, and on any device where `user_token` is empty, every request carries the **same static key**. Splitting it across two classes does not hide it.
- If the server authorizes by `api_key` alone, or does not check that `user_token` belongs to `user_id`/`project_id`, any user, or anyone holding the static key, can:
  - read other users' profiles, payments, factors and projects;
  - delete their cloud projects;
  - confirm or cancel their orders.
- The OTP flow is `login(mobile)`, which returns `user_id` for any number (`q3/c.java:1315`), followed by `verify(user_id, 5-digit code)`. Without server-side rate limiting, 100,000 guesses take over any account.
- Every 403 response is ignored on the client (see M5), so the server cannot even force a logout.

**Fix:**
- Server side: issue a per-user bearer token at `verify` and derive identity from it on every endpoint. Stop accepting `user_id` from the client. Authorize `project_id` against the owner. Rate-limit and lock out `verify`. Rotate the static key.
- Client side: send `Authorization: Bearer <token>` only, and on 401/403 clear the session.

### C2. Recursive delete of a directory named after the project title: path traversal can wipe shared storage

**Where:**
- `src/com/padcod/cutclick/Utils/A.java:43-62,80-82`
- Callers:
  - `src/C2/b.java:81-83` (cloud project, title from server)
  - `src/P3/z.java:76-78` (cloud, from server)
  - `src/P3/D.java:62`
  - `src/com/padcod/cutclick/Activity/ProjectPlatePartActivity.java:14395` (title from intent extra `projectName`, line 2479)
  - `src/com/padcod/cutclick/Activity/ProjectPlateActivity.java:1059`

```java
public static void b(String str) { a(new File(g(str.trim()))); }          // recursive delete
public static String g(String str) { return new File(d() + "/CutClick/" + str.trim()).getAbsolutePath(); }
// d() = Environment.getExternalStoragePublicDirectory(DOWNLOADS)
// C2/b.java:
String trim = cloudProjectDetail.getTitle().trim();
A.b(trim);
```

**What's wrong:** The project title is not sanitized anywhere. `dialog_add_project.xml` has only `maxLength=30` and no character filter.
- A title of `..` deletes all of `Download/`.
- `../..` deletes `/storage/emulated/0`. The app asks for and holds `MANAGE_EXTERNAL_STORAGE`, so it can delete all of it.
- A title that is empty or only spaces deletes the cutting maps of **every** project.

Cloud projects can be pushed to another user (`sendCloudProjectToUser`, `U3/b.java:21`), and that title comes from the server. So **a remote user can wipe a victim's storage** when the victim opens "cutting map" on the shared project.

**Fix:**
- Never build paths from titles. Use the numeric project id as the directory name, or sanitize to `[\p{L}\p{N} _-]` and reject `.`/`..`.
- Before deleting, canonicalize the path and check `canonical.startsWith(baseCanonical + File.separator)`.
- Store generated files in `getExternalFilesDir()` or MediaStore instead of public Downloads (see M3).

---

## HIGH

### H1. Zip Slip, with Android 14's built-in protection explicitly turned off

**Where:**
- `src/X3/u.java:190-226` (assets ZIP, `SignUpActivity`)
- `src/X3/u.java:230-245` (assets ZIP, `SplashScreenActivity`)
- `src/S1/n.java:171-205` and around line 228 (cloud project `info.zip` extracted into `Download/CutClick/<title>/`)

```java
if (Build.VERSION.SDK_INT >= 34) { ZipPathValidator.clearCallback(); }   // turns off the API 34+ "../" check
...
String name = nextEntry.getName();
FileOutputStream fileOutputStream = new FileOutputStream(l3 + name);      // no canonical-path check
```

**What's wrong:** An entry named `../../../../../../data/user/0/com.padcod.cutclick/shared_prefs/…xml` or `…/databases/Project.db` overwrites the app's private files. That lets an attacker plant a `user_id`/`user_token`, or tamper with the plate and price database. The ZIP comes from:
- a server-supplied URL, which is downloaded over plain HTTP on API ≤ 24 (H2), so anyone on the network can supply it;
- the per-project `info.zip`.

**Fix:** Remove the `clearCallback()` calls. For every entry, resolve `File out = new File(destDir, name)` and reject it unless `out.getCanonicalPath().startsWith(destDir.getCanonicalPath() + File.separator)`. Verify the ZIP with a SHA-256 the server sends over TLS.

### H2. TLS validation turned off on Android 5.0–7.0, and HTTP downgrade of the assets download

**Where:**
- `src/T3/d.java:28-57` and `src/U3/a.java:27-57` (smali confirms `SDK_INT <= 0x18`)
- `src/T3/c.java` (empty `checkServerTrusted`)
- `src/T3/b.java` (`verify()` returns `true`)
- `src/com/padcod/cutclick/Activity/q.java:205-206`
- Manifest: `android:usesCleartextTraffic="true"`

```java
TrustManager[] trustManagerArr = {new c(0)};          // checkServerTrusted() { }  -> trusts everything
SSLContext.getInstance("SSL").init(null, trustManagerArr, ...);
a7.f3259t = new b();                                   // HostnameVerifier -> return true
...
if (Build.VERSION.SDK_INT <= 24) assets = data.getAssets().replace("https://", "http://");
```

**What's wrong:** On API 21–24, which are common on older devices in Iran, anyone on the network can MITM every API call: OTP, user data, api_key. They can also replace the assets ZIP, which chains into H1.

**Fix:**
- Delete the custom trust manager and hostname verifier.
- For old devices, bundle the needed root CA (Let's Encrypt ISRG X1) through `network_security_config` `<trust-anchors>`, or use Conscrypt.
- Remove the `https` to `http` rewrite.
- Set `usesCleartextTraffic="false"` (nothing else needs HTTP; the Instagram link opens in a browser).

### H3. Database upgrade drops all user projects, and the update flow can lose data or trap the user

**Where:**
- `src/N3/b.java:1388-1399`
- Update flow: `src/K0/c.java:503-647`, `src/J1/i.java:515-744`, `src/X3/u.java:1996-2012`

```java
public final void onUpgrade(SQLiteDatabase db, int i6, int i7) {
    if (i7 > i6) {
        db.execSQL("DROP TABLE IF EXISTS projects"); ... "project_plate_parts" ... "cabinet" ...
        onCreate(db);
    }
}
```

**What's wrong:**
- `Project.db` (version 16) holds all user projects, plates, parts and cabinets. Any future schema bump wipes all of it.
- Projects are backed up to the cloud first (`storeCloudAllProjects`, `J1/i.java:743`) **only** when the user taps "direct download". Updates through Bazaar, Myket or Play (`J1/i.java:519-537`) skip the backup.
- On the direct path, if the backup upload fails, `onFailure` only dismisses the progress dialog (`X3/u.java:1996-1998`) and never opens the download link. When `is_force_update=1` the dialog cannot be cancelled (`K0/c.java:537`, close button hidden), so the user is **stuck**.

**Fix:** Write real `ALTER TABLE` migrations, or move to Room with migrations, and never drop user tables. Open the store or direct link whether or not the backup succeeded. Run the backup independently and get the user's consent (see M13).

---

## MEDIUM

### M1. Exported activities with no permission check (manifest)

**Where:**
- `dec/AndroidManifest.xml`: `ProjectCabinetActivity`, `ProjectCabinetPartActivity`, `PdfViewActivity` (`exported="true"`, no `permission`)
- `src/com/padcod/cutclick/Activity/PdfViewActivity.java:48-58`
- `SplashScreenActivity.java:83-92`

```java
File file = new File(getIntent().getStringExtra("path"));   // NPE if the extra is missing; any path is accepted
```

**What's wrong:**
- Any installed app can:
  - open the cabinet editors on any local `projectId` and skip the splash/login flow (`ProjectCabinetActivity.s()` immediately calls `getUser(user_id)`);
  - make `PdfViewActivity` render an attacker-chosen PDF inside the app's own UI (phishing);
  - crash any of these activities by leaving out extras.
- `SplashScreenActivity` (the exported launcher) does `Integer.parseInt(getString("processStep"))` with no try/catch, so an extra like `processStep=abc` crashes the app.
- The `cutclick://` scheme is declared, but `getIntent().getData()` is never read. The deep link does nothing except let any website launch the app.

**Fix:** Set `exported="false"` on all three; they are only started internally. Validate extras and wrap `parseInt` in try/catch. Remove the `cutclick` intent-filter, or implement it with allow-listed hosts and paths.

- `src/com/padcod/cutclick/Broadcast/SmsBroadcastReceiver.java:20-29`
- `LoginActivity.java:381-386`

```java
registerReceiver(this.f7304S, this.f7303R, 2);                 // 2 = RECEIVER_EXPORTED, no broadcastPermission
...
this.onSmsReceiveListener.onReceive(str.substring(0, 5).trim()); // NPE if listener is null; StringIndexOutOfBounds if SMS < 5 chars
```

**What's wrong:**
- The dynamic registration is exported without `SmsRetriever.SEND_PERMISSION`, so any installed app can inject a fake `SMS_RETRIEVED` broadcast.
- The receiver is also declared in the manifest; that instance has a `null` listener, so a real SMS can crash the app in the background.
- `substring(0,5)` assumes the code is the first 5 characters of the SMS.

**Fix:** Register with `ContextCompat.RECEIVER_NOT_EXPORTED` (or pass `SmsRetriever.SEND_PERMISSION`), remove the manifest declaration, null-check the listener, and extract the code with a regex such as `\b\d{5}\b`.

### M3. Over-broad permissions
- `MANAGE_EXTERNAL_STORAGE` + `requestLegacyExternalStorage` + `WRITE/READ_EXTERNAL_STORAGE`: the app only writes its own PDFs/ZIPs into `Download/CutClick/`. "All files access" is not justified and is rejected by Google Play policy for this kind of app. Use `getExternalFilesDir()` or MediaStore and drop the permission. It also makes C2 far more dangerous.
- `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`: declared, but the only code that reads location is AppCompat's built-in night-mode helper. The "nearest service centers" text asks the user to turn on GPS, but no app code requests a location. Remove the permissions, or implement the feature properly with a runtime request.
- `CHANGE_NETWORK_STATE`: not needed.

### M4. Silent upload of all local projects
`J1/i.java:541-743`: before a direct-link update, every local project (customers, prices, parts) is uploaded to the server (`storeCloudAllProjects`) without telling the user. Ask for consent and explain what is uploaded.

### M5. 403 responses are ignored
`H3/C0030d0.java:148` (and the same pattern in ~48 places): `if (response.code() == 403) { ... }` has an empty body, so an expired/invalid session is never handled; the user just sees "Error connecting to server". Clear the session and send the user to login on 401/403.

### M6. Crash risks on server data and user input
- `H3/C0043q.java:68-69`: `Integer.parseInt(factorItem.getUnit_price())` / `getTotal_price()` - money in Rial/Toman overflows `int` (max ~2.1 billion) on large invoices, and any non-numeric value crashes. Use `Long`/`BigDecimal` with try/catch.
- `H3/f0.java:912-917`: `submit_date.split(" ")[1]` / `[2]` - crashes if the server date format changes.
- `SplashScreenActivity.java:86,91`: `parseInt` on intent extras without try/catch (see M1).
- `O3/M.java:33`: shows a dialog from a background thread.

### M7. SQL built by string concatenation
`N3/b.java:179`: `"SELECT * FROM projects WHERE title LIKE '" + str + "%'"` - a project title containing an apostrophe (`'`) crashes the query; it is also SQL injection into the local DB. Use `rawQuery("... LIKE ?", new String[]{str + "%"})`.

### M8. Memory leaks
`MainActivity.java:141,349`: static singletons hold a reference to `MainActivity` (and other activities), leaking the whole view tree after rotation/recreation. Combined with `largeHeap="true"`, this hides the problem instead of fixing it.

### M9. Hardcoded version number in the update check
`K0/c.java:503-505`: `getVersion() <= 27` and `getVersion() == 27` - the app's own version code is hardcoded instead of using `BuildConfig.VERSION_CODE`. Every release must remember to edit these numbers, or the update dialog breaks. If `is_force_update=1`, the dialog cannot be closed.

## LOW

### L1. PDF sharing is broken
`H3/B.java:1101-1104`: `setType("pdf/*")` (the correct MIME type is `application/pdf`) and `Uri.parse(file.getAbsolutePath())` (a raw path, not a `content://` URI). On Android 7+ this either fails or throws `FileUriExposedException`. Use `FileProvider.getUriForFile(...)` + `FLAG_GRANT_READ_URI_PERMISSION` (the FileProvider is already declared).

### L2. Release build logs sensitive data
23+ `Log.i/Log.e` calls in app code, including full push payloads, project JSON and the SMS hash (`Log.i("AAA", ...)`). Strip logs in release with R8 rules (`-assumenosideeffects class android.util.Log`).

### L3. Static API key and Firebase key in the APK
`T3/a.java:33-38` + `CustomView/MyKeyboard.java:89` (split API key) and `google_api_key` in `res/values/strings.xml`. The Firebase key is normal, but should be restricted in Google Cloud console (Android app + package + SHA-1). The static API key must not grant any data access by itself (see C1).

### L4. Dead / useless components
- `ir.heydarii.appupdater.directlink.DirectLinkDownload` - exported receiver for `DOWNLOAD_COMPLETE`; effectively dead code.
- `cutclick://` deep link - declared but never handled (M1).

### L5. Placeholder and test content shipped in release
Layouts contain lorem-ipsum text, "Test", "New project page (Ali)", "Message two Message two...", fake dates ("1399/12/12"), a repeated "Padcod Padcod Padcod..." question, and a hardcoded street address. These are design-time `android:text` values that should be `tools:text`, otherwise they flash on screen before real data loads.

### L6. Maintainability
- `ProjectPlatePartActivity.java` is ~14,700 lines, and `O3/C0081o` (the part dialog) is ~45,000 lines of decompiled code - far too large to maintain or test.
- ~1,000 hardcoded Persian strings in code instead of `strings.xml`, so the app cannot be localized normally.
- UI text is used as program state: the toolbar title decides navigation (`q1/a.java:238-262`, `MainActivity.onBackPressed` switch on the title), menu items are matched by their visible text (`c4/DialogC0297b.java`), and the order status is detected with `status_title.contains("در حال تولید")` (`H3/f0.java:764-802`). Any wording change or translation breaks logic. Use ids/enums.
- 155 layouts force `layoutDirection="rtl"` instead of relying on the locale.
- Portrait orientation is forced on all activities (bad on tablets / foldables).

## Not bugs (decompiler artefacts - do not "fix")
- `MyFirebaseMessagingService.java:85` push "ticket" check, and `H3/C0049x.java:363` PVC color condition look wrong in jadx output, but the smali is correct.

---

## English translation - what was done

**Output:** `CutClick-4.0.1-EN.apk` (package and version unchanged, re-signed with a new key).

- 676 unique Persian strings translated (1,242 replacements in layouts/resources, 558 in code / smali).
- 512 forced `rtl` layout/text directions switched to `ltr`, so screens read left-to-right.
- Java `switch` statements on Persian strings (`MainActivity.onBackPressed`, `c4/b` menu handler) compile to `String.hashCode()` tables; the hash constants were recomputed for the English text, so navigation still works.
- Every Persian string was mapped to exactly one English string, so internal `equals()` comparisons of UI text (navigation keys, menu items, "None", "Matching color", "mm" unit parsing, the `"Name"` / `"n"` / `"pcs"` / `"(size)"` placeholders) still match. The OTP prompt was worded so that it contains only one letter "n", because the code does `.replace("n", phoneNumber)`.
- The name field on the sign-up screen had `android:digits` limited to Persian letters; Latin letters A-Z / a-z were added so English names can be typed.

**Left in Persian on purpose:**
- Persian/Arabic digit characters in the digit-normalizer (`Utils/A.java`) - needed so Persian keyboards still work.
- 5 literals in `H3/f0.smali` that are compared against **server** data (`status_title.contains("در حال تولید")`, `"آماده تحویل"`, `"تامین مصالح"`, `"در حال محاسبه"`, `submit_date.contains("سه شنبه")`). Translating them would break the order-status progress display.

**Limitations you should know about:**
1. **Text that comes from the server stays Persian** (order statuses, notifications, service-center names, plans, news, terms pages, WebView pages, PDF invoices generated by the server). Only the server owner can translate those.
2. **Values you pick are now saved/sent in English.** For example the edge-band color ("Matching color", "White", "None") is stored and sent to the server in `ProjectPlateSendData.color`, so the cutting workshop will see the English word.
3. **Uninstall the original app first.** The APK is signed with a new key, so it cannot be installed over the official version (and official updates cannot be installed over it). Local projects on the phone are lost on uninstall - back them up to the cloud first.
4. **SMS auto-fill of the login code will not work** (the SMS hash depends on the signing key). Type the 5-digit code manually.
5. If the server announces a version newer than 27 with forced update, the app will show a non-closable update dialog (same as the original app).
6. The amount-in-words converter keeps Persian word order (e.g. "one hundred and twenty and five").
7. Layout direction was flipped from RTL to LTR; some screens designed only for RTL may have small alignment issues.
8. The APK was rebuilt, signed and verified (`apksigner` v1/v2/v3, zipalign) and re-decoded successfully, but it was **not run on a device or emulator** in this environment.

A complete Persian -> English table is in `translation_fa_en.csv`.
