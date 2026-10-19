import os,re,sys,shutil
S=sys.argv[1]; src=S+'/apk_en'; dst=S+'/apk_fix'
if os.path.exists(dst): shutil.rmtree(dst)
shutil.copytree(src,dst,symlinks=True)
FIX='Lcom/padcod/cutclick/Utils/Fix;'
shutil.copy(S+'/fixsrc/out/fixdec/smali/com/padcod/cutclick/Utils/Fix.smali', dst+'/smali/com/padcod/cutclick/Utils/Fix.smali')
log=[]
def rd(p): return open(dst+'/'+p,encoding='utf-8').read()
def wr(p,t): open(dst+'/'+p,'w',encoding='utf-8').write(t)
def sub(p,pat,rep,count,flags=0,desc=''):
    t=rd(p); n=len(re.findall(pat,t,flags))
    assert n==count,f'{desc}: {p} expected {count} got {n}'
    wr(p,re.sub(pat,rep,t,flags=flags)); log.append(f'{desc}: {p} x{n}')
def method_body(p,sig,newbody,desc):
    t=rd(p); i=t.index(sig); j=t.index('.end method',i)
    wr(p,t[:i]+sig+'\n'+newbody+'\n'+t[j:]); log.append(f'{desc}: {p}')

# C2 safe delete
method_body('smali/com/padcod/cutclick/Utils/A.smali','.method public static b(Ljava/lang/String;)V',
f'''    .locals 0

    invoke-static {{p0}}, {FIX}->deleteProjectDir(Ljava/lang/String;)V

    return-void''','C2 safe project-folder delete')

# H1 zip slip: keep Android 14 validator, check entry names
sub('smali/com/padcod/cutclick/Activity/K.smali',r'\n\s*invoke-static \{\}, Ldalvik/system/ZipPathValidator;->clearCallback\(\)V\n','\n',1,desc='H1 keep ZipPathValidator')
for p,cnt in [('smali/X3/u.smali',2),('smali/S1/n.smali',2)]:
    sub(p,r'(invoke-virtual \{v7\}, Ljava/util/zip/ZipEntry;->getName\(\)Ljava/lang/String;\n(?:\s*\.line \d+\n|\s*\n)*\s*move-result-object (v\d+)\n)',
        lambda m:m.group(1)+f'\n    invoke-static/range {{{m.group(2)} .. {m.group(2)}}}, {FIX}->zipEntry(Ljava/lang/String;)Ljava/lang/String;\n\n    move-result-object {m.group(2)}\n',cnt,desc='H1 zip entry check')

# H2 TLS: replace trust-all manager and hostname verifier
t=rd('smali/T3/c.smali')
for m in ['checkServerTrusted']:
    pass
def repl_method(p,name_sig,body,desc):
    t=rd(p); m=re.search(r'\.method public final '+re.escape(name_sig)+r'\n(.*?)\.end method',t,re.S)
    assert m,desc
    wr(p,t[:m.start(1)]+body+'\n'+t[m.end(1):]); log.append(f'{desc}: {p}')
repl_method('smali/T3/c.smali','checkServerTrusted([Ljava/security/cert/X509Certificate;Ljava/lang/String;)V',
f'''    .locals 0

    invoke-static {{p1, p2}}, {FIX}->checkServerTrusted([Ljava/security/cert/X509Certificate;Ljava/lang/String;)V

    return-void''','H2 validate server certs')
repl_method('smali/T3/c.smali','getAcceptedIssuers()[Ljava/security/cert/X509Certificate;',
f'''    .locals 1

    invoke-static {{}}, {FIX}->acceptedIssuers()[Ljava/security/cert/X509Certificate;

    move-result-object v0

    return-object v0''','H2 accepted issuers')
repl_method('smali/T3/b.smali','verify(Ljava/lang/String;Ljavax/net/ssl/SSLSession;)Z',
f'''    .locals 0

    invoke-static {{p1, p2}}, {FIX}->verifyHost(Ljava/lang/String;Ljavax/net/ssl/SSLSession;)Z

    move-result p1

    return p1''','H2 hostname verification')
sub('smali/com/padcod/cutclick/Activity/q.smali',r'const-string v1, "http://"','const-string v1, "https://"',1,desc='H2 no https->http downgrade')

# M2 SMS receiver
method_body('smali/a1/n.smali','.method public static bridge synthetic r(Lcom/padcod/cutclick/Activity/LoginActivity;Landroid/content/BroadcastReceiver;Landroid/content/IntentFilter;)V',
f'''    .locals 0

    invoke-static {{p0, p1, p2}}, {FIX}->registerSms(Landroid/content/Context;Landroid/content/BroadcastReceiver;Landroid/content/IntentFilter;)V

    return-void''','M2 permission-protected SMS receiver (API33+)')
sub('smali/com/padcod/cutclick/Activity/LoginActivity.smali',
    r'invoke-virtual \{p0, v0, v1\}, Landroid/content/Context;->registerReceiver\(Landroid/content/BroadcastReceiver;Landroid/content/IntentFilter;\)Landroid/content/Intent;',
    f'invoke-static {{p0, v0, v1}}, {FIX}->registerSms(Landroid/content/Context;Landroid/content/BroadcastReceiver;Landroid/content/IntentFilter;)V',1,desc='M2 permission-protected SMS receiver (<API33)')
method_body('smali/com/padcod/cutclick/Broadcast/SmsBroadcastReceiver.smali','.method public onReceive(Landroid/content/Context;Landroid/content/Intent;)V',
f'''    .locals 2

    if-eqz p2, :cond_done

    const-string p1, "com.google.android.gms.auth.api.phone.SMS_RETRIEVED"

    invoke-virtual {{p2}}, Landroid/content/Intent;->getAction()Ljava/lang/String;

    move-result-object v0

    invoke-virtual {{p1, v0}}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result p1

    if-eqz p1, :cond_done

    invoke-virtual {{p2}}, Landroid/content/Intent;->getExtras()Landroid/os/Bundle;

    move-result-object p1

    if-eqz p1, :cond_done

    const-string p2, "com.google.android.gms.auth.api.phone.EXTRA_STATUS"

    invoke-virtual {{p1, p2}}, Landroid/os/BaseBundle;->get(Ljava/lang/String;)Ljava/lang/Object;

    move-result-object p2

    instance-of v0, p2, Lcom/google/android/gms/common/api/Status;

    if-eqz v0, :cond_done

    check-cast p2, Lcom/google/android/gms/common/api/Status;

    iget p2, p2, Lcom/google/android/gms/common/api/Status;->g:I

    if-nez p2, :cond_done

    const-string p2, "com.google.android.gms.auth.api.phone.EXTRA_SMS_MESSAGE"

    invoke-virtual {{p1, p2}}, Landroid/os/BaseBundle;->get(Ljava/lang/String;)Ljava/lang/Object;

    move-result-object p1

    instance-of v0, p1, Ljava/lang/String;

    if-eqz v0, :cond_done

    check-cast p1, Ljava/lang/String;

    invoke-static {{p1}}, {FIX}->otp(Ljava/lang/String;)Ljava/lang/String;

    move-result-object p1

    iget-object p2, p0, Lcom/padcod/cutclick/Broadcast/SmsBroadcastReceiver;->onSmsReceiveListener:Lcom/padcod/cutclick/Broadcast/SmsBroadcastReceiver$OnSmsReceiveListener;

    if-eqz p2, :cond_done

    invoke-interface {{p2, p1}}, Lcom/padcod/cutclick/Broadcast/SmsBroadcastReceiver$OnSmsReceiveListener;->onReceive(Ljava/lang/String;)V

    :cond_done
    return-void''','M2 crash-safe SMS parsing')

# M7 SQL quote escaping
sub('smali/N3/b.smali',r'(const-string v3, "SELECT \* FROM projects WHERE title LIKE  \\\'"\n(?:\s*\.line \d+\n|\s*\n)*\s*invoke-direct \{v2, v3\}, Ljava/lang/StringBuilder;-><init>\(Ljava/lang/String;\)V\n(?:\s*\.line \d+\n|\s*\n)*)\s*invoke-virtual \{v2, p1\}',
    lambda m:m.group(1)+f'    invoke-static {{p1}}, {FIX}->sqlLike(Ljava/lang/String;)Ljava/lang/String;\n\n    move-result-object v3\n\n    invoke-virtual {{v2, v3}}',1,desc='M7 SQL escaping')

# M6 money: parseInt->Integer.valueOf->"%,d" becomes Fix.money (Long)
money_pat=r'invoke-static \{([vp]\d+)\}, Ljava/lang/Integer;->parseInt\(Ljava/lang/String;\)I\n(?:\s*\.line \d+\n|\s*\n)*\s*move-result \1\n(?:\s*\.line \d+\n|\s*\n)*\s*invoke-static \{\1\}, Ljava/lang/Integer;->valueOf\(I\)Ljava/lang/Integer;\n(?:\s*\.line \d+\n|\s*\n)*\s*move-result-object \1\n'
total=0
for sd in [x for x in os.listdir(dst) if x.startswith('smali')]:
    for d,_,fs in os.walk(os.path.join(dst,sd)):
        for f in fs:
            p=os.path.join(d,f); t=open(p,encoding='utf-8').read()
            if 'Integer;->parseInt' not in t or '"%,d"' not in t: continue
            new,n=re.subn(money_pat,lambda m:f'invoke-static {{{m.group(1)}}}, {FIX}->money(Ljava/lang/String;)Ljava/lang/Long;\n\n    move-result-object {m.group(1)}\n',t)
            if n: open(p,'w',encoding='utf-8').write(new); total+=n; log.append(f'M6 money long-safe: {os.path.relpath(p,dst)} x{n}')

# M1 crash-safe parseInt of notification extras
sub('smali/com/padcod/cutclick/Activity/SplashScreenActivity.smali',r'Ljava/lang/Integer;->parseInt\(Ljava/lang/String;\)I',f'{FIX}->parseIntSafe(Ljava/lang/String;)I',2,desc='M1 safe extras parsing')

# L1 PDF sharing
sub('smali/H3/B.smali',r'const-string v2, "pdf/\*"','const-string v2, "application/pdf"',1,desc='L1 PDF MIME type')
sub('smali/H3/B.smali',r'(invoke-virtual \{v7\}, Ljava/io/File;->getAbsolutePath\(\)Ljava/lang/String;\n(?:\s*\.line \d+\n|\s*\n)*\s*move-result-object v2\n(?:\s*\.line \d+\n|\s*\n)*)\s*invoke-static \{v2\}, Landroid/net/Uri;->parse\(Ljava/lang/String;\)Landroid/net/Uri;(\n(?:\s*\.line \d+\n|\s*\n)*\s*move-result-object v2\n(?:\s*\.line \d+\n|\s*\n)*\s*const-string v3, "android.intent.extra.STREAM")',
    lambda m:m.group(1)+f'    invoke-static {{v15, v1, v2}}, {FIX}->pdfUri(Landroid/content/Context;Landroid/content/Intent;Ljava/lang/String;)Landroid/net/Uri;'+m.group(2),1,desc='L1 FileProvider URI')
sub('smali/H3/B.smali',r'const-string v2, "share file with"','const-string v2, "Share PDF"',1,desc='L1 chooser title')

# L2 strip debug/info logging (Log.v/d/i) everywhere
nlog=0
LOGP=re.compile(r'\n\s*invoke-static(?:/range)? \{[^}]*\}, Landroid/util/Log;->(?:v|d|i)\(Ljava/lang/String;Ljava/lang/String;(?:Ljava/lang/Throwable;)?\)I\n((?:\s*\.line \d+\n|\s*\n)*\s*move-result [vp]\d+\n)?')
for sd in [x for x in os.listdir(dst) if x.startswith('smali')]:
    for d,_,fs in os.walk(os.path.join(dst,sd)):
        for f in fs:
            p=os.path.join(d,f); t=open(p,encoding='utf-8').read()
            if 'Landroid/util/Log;->' not in t: continue
            new,n=LOGP.subn('\n',t)
            if n: open(p,'w',encoding='utf-8').write(new); nlog+=n
log.append(f'L2 removed Log.v/d/i calls: {nlog}')

# Manifest
m=rd('AndroidManifest.xml'); o=m
for perm in ['ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION','CHANGE_NETWORK_STATE']:
    m=m.replace(f'<uses-permission android:name="android.permission.{perm}"/>\n    ','')
for act in ['ProjectCabinetActivity','ProjectCabinetPartActivity','PdfViewActivity']:
    m=m.replace(f'android:exported="true" android:name="com.padcod.cutclick.Activity.{act}"',f'android:exported="false" android:name="com.padcod.cutclick.Activity.{act}"')
m=re.sub(r'<receiver android:enabled="true" android:exported="false" android:name="com.padcod.cutclick.Broadcast.SmsBroadcastReceiver">.*?</receiver>\s*','',m,flags=re.S)
assert m.count('android:exported="false" android:name="com.padcod.cutclick.Activity.P')>=3 and 'ACCESS_FINE' not in m and 'Broadcast.SmsBroadcastReceiver' not in m
wr('AndroidManifest.xml',m); log.append('Manifest: removed location/CHANGE_NETWORK_STATE, un-exported 3 activities, removed static SMS receiver')

y=rd('apktool.yml'); y=y.replace('versionName: 4.0.1','versionName: 4.0.1-en-fix1'); wr('apktool.yml',y)
print('\n'.join(log)); print('money sites',total)
