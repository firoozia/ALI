# CutClick 4.0.1-en-fix1

English build plus the client-side fixes from the analysis report. Same package (`com.padcod.cutclick`), same versionCode (27), and the same signing key as the earlier English build, so it installs straight over `CutClick-4.0.1-EN.apk`.

## Fixed

| ID | Problem | Fix |
|---|---|---|
| C2 | A project title like `..` or `../..` made the app recursively delete Downloads or all shared storage | Deletes are now confined to `Download/CutClick/<project>`. Empty titles and anything that resolves outside that folder are ignored (`Utils/A.b` → `Fix.deleteProjectDir`) |
| H1 | Zip Slip: ZIP entries could overwrite the app's private files; the Android 14 protection was turned off | Android 14's `ZipPathValidator` is no longer disabled. Every entry name is checked, and `..` and absolute paths are rejected with a `ZipException`, which the existing IOException handlers catch (`X3/u`, `S1/n`) |
| H2 | On Android 7.0 and older, every TLS certificate and hostname was accepted, and the assets ZIP was downloaded over plain HTTP | Server certificates are validated against the system CAs plus bundled ISRG Root X1/X2 (Let's Encrypt), so old phones still connect. The hostname is verified, and the https→http rewrite is removed (`T3/b`, `T3/c`, `Activity/q`) |
| M1 | `ProjectCabinetActivity`, `ProjectCabinetPartActivity` and `PdfViewActivity` could be launched by any app; bad notification extras crashed the splash screen | All three are `exported="false"`. `processStep` and `processProjectId` are parsed safely |
| M2 | The SMS-retriever receiver accepted broadcasts from any app and could crash (null listener, short SMS, wrong extra type) | Registered with Google Play services' `SEND` permission. The unused manifest receiver is removed. Type and null checks were added, and the 4–6 digit code is extracted with a regex |
| M3 | Unneeded permissions | Removed `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` and `CHANGE_NETWORK_STATE` |
| M6 | Invoice amounts parsed as `int`: overflow above about 2.1 billion, and a crash on malformed values | Parsed as `Long`, with comma and decimal handling, falling back to 0 (`H3/C0043q`) |
| M7 | A project title containing `'` crashed the duplicate-name SQL query | The quote is escaped (`N3/b.A`) |
| L1 | Sharing a PDF was broken: wrong MIME type and a raw file path | `application/pdf`, a `content://` URI from the app's FileProvider and a read-permission grant (`H3/B`) |
| L2 | Debug logs in the release build (push payloads, project JSON, the SMS hash) | 503 `Log.v`/`Log.d`/`Log.i` calls removed |

## Not fixable in the APK (needs the Padcod server or source code)

- **C1** Identity comes from a client-supplied `user_id` plus a static API key. The server must issue and check per-user tokens and rate-limit OTP attempts.
- **H3** `onUpgrade` drops every table. This only matters when the developers bump the DB version, which this build doesn't do.
- **M5** 403 responses are ignored. **M8** Activity memory leaks. **M9** The version number is hardcoded in the update check. Code size and structure. These need the original source code.
- `MANAGE_EXTERNAL_STORAGE` is kept, because the app writes cutting maps into public Downloads. Removing it would need the storage code rewritten. C2 removes the dangerous part.
- `usesCleartextTraffic` is kept, in case the server sends `http://` image or file links.

## Testing done

- Rebuilt with apktool, zipaligned and signed (v1/v2/v3 verified), then decompiled again with jadx, and every patched method was reviewed.
- The new helper class (`Fix`) passed JVM unit tests: zip-path blocking, OTP extraction, money parsing, SQL escaping, and loading the bundled root certificates.
- **Not yet run on a phone or emulator** (none available in the build environment). Please test login, creating and opening a project, the cutting map, sharing a PDF, invoices and cloud restore.
