import os,re,sys,json,shutil
S=sys.argv[1]; src=S+'/apk_dec'; dst=S+'/apk_en'
M=json.load(open(S+'/map_fa_en.json',encoding='utf-8'))
if os.path.exists(dst): shutil.rmtree(dst)
shutil.copytree(src,dst,symlinks=True)
P=re.compile(r'[؀-ۿ]')
LOC=re.compile(r'^values-(?![a-z]+dp|v\d|land|port|night|large|small|xlarge|watch|hdpi|ldltr|ldrtl|h\d|w\d|sw\d)')
LATIN='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
stats={'res':0,'smali':0,'kept':0,'switch':0,'dir':0}
untr=set()
def rattr(m):
    v=m.group(2)
    if P.search(v):
        if m.group(1).endswith('android:digits'):
            stats['res']+=1; return f'{m.group(1)}="{v}{LATIN}"'
        if v in M: stats['res']+=1; return f'{m.group(1)}="{M[v]}"'
        untr.add(v)
    return m.group(0)
def rtext(m):
    v=m.group(1)
    if P.search(v):
        if v in M: stats['res']+=1; return '>'+M[v]+'<'
        untr.add(v)
    return m.group(0)
for d,_,fs in os.walk(os.path.join(dst,'res')):
    if LOC.match(os.path.basename(d)): continue
    for f in fs:
        if not f.endswith('.xml'): continue
        p=os.path.join(d,f); t=open(p,encoding='utf-8').read(); o=t
        t=re.sub(r'([\w:]+)="([^"]*)"',rattr,t)
        t=re.sub(r'>([^<>]+)<',rtext,t)
        if '/layout' in p:
            n=len(re.findall(r'(layoutDirection|textDirection)="rtl"',t)); stats['dir']+=n
            t=re.sub(r'(android:layoutDirection|android:textDirection)="rtl"',r'\1="ltr"',t)
        if t!=o: open(p,'w',encoding='utf-8').write(t)
def dec(s): return s.encode('latin-1','backslashreplace').decode('unicode_escape')
def enc(s):
    out=[]
    for ch in s:
        if ch=='\\': out.append('\\\\')
        elif ch=='"': out.append('\\"')
        elif ch=='\n': out.append('\\n')
        elif ch=="'": out.append("\\'")
        elif 32<=ord(ch)<127: out.append(ch)
        else: out.append('\\u%04x'%ord(ch))
    return ''.join(out)
def jhash(s):
    h=0
    for cu in s.encode('utf-16-be').hex() and [int.from_bytes(s.encode('utf-16-be')[i:i+2],'big') for i in range(0,len(s.encode('utf-16-be')),2)]:
        h=(31*h+cu)&0xffffffff
    return h-(1<<32) if h>=1<<31 else h
CS=re.compile(r'^(\s*const-string(?:/jumbo)? [vp]\d+, )"(.*)"\s*$')
for sd in [x for x in os.listdir(dst) if x.startswith('smali')]:
    for d,_,fs in os.walk(os.path.join(dst,sd)):
        for f in fs:
            p=os.path.join(d,f); rel=os.path.relpath(p,dst)
            if rel.endswith('S4/b.smali'): continue
            lines=open(p,encoding='utf-8').read().split('\n')
            changed=False; hmap={}
            for i,l in enumerate(lines):
                m=CS.match(l)
                if not m or '\\u06' not in m.group(2): continue
                s=dec(m.group(2))
                if s not in M: untr.add(s); continue
                nxt='\n'.join(lines[i+1:i+6])
                if '->contains(Ljava/lang/CharSequence;)Z' in nxt:
                    stats['kept']+=1; print('KEEP (server-data contains):',rel,s); continue
                lines[i]=m.group(1)+'"'+enc(M[s])+'"'; changed=True; stats['smali']+=1
                hmap[jhash(s)]=jhash(M[s])
            if changed and 'Ljava/lang/String;->hashCode()I' in '\n'.join(lines):
                i=0
                while i<len(lines):
                    if lines[i].strip()=='.sparse-switch':
                        j=i+1; ents=[]
                        while lines[j].strip()!='.end sparse-switch':
                            k,lab=lines[j].strip().split(' -> '); ents.append([int(k,16) if not k.startswith('-') else -int(k[1:],16),lab]); j+=1
                        hit=False
                        for e in ents:
                            if e[0] in hmap: e[0]=hmap[e[0]]; hit=True; stats['switch']+=1
                        if hit:
                            ents.sort(key=lambda e:e[0])
                            assert len({e[0] for e in ents})==len(ents),'hash collision'
                            ind=lines[i+1][:len(lines[i+1])-len(lines[i+1].lstrip())]
                            lines[i+1:j]=[f"{ind}{'-' if k<0 else ''}0x{abs(k):x} -> {lab}" for k,lab in ents]
                            print('switch patched',rel)
                            j=i+1+len(ents)
                        i=j
                    i+=1
            if changed: open(p,'w',encoding='utf-8').write('\n'.join(lines))
print(stats); print('untranslated:',len(untr)); [print(' ',repr(u)[:120]) for u in sorted(untr)]
