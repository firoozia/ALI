import os,re,sys,json
root=sys.argv[1]; out=sys.argv[2]
P=re.compile(r'[؀-ۿ]')
LOC=re.compile(r'^values-(?![a-z]+dp|v\d|land|port|night|large|small|xlarge|watch|hdpi|ldltr|ldrtl|h\d|w\d|sw\d)')
res={}; sm={}
for d,_,fs in os.walk(os.path.join(root,'res')):
    base=os.path.basename(d)
    if LOC.match(base): continue
    for f in fs:
        if not f.endswith('.xml'): continue
        t=open(os.path.join(d,f),encoding='utf-8').read()
        for m in re.finditer(r'="([^"]*)"',t):
            if P.search(m.group(1)): res.setdefault(m.group(1),set()).add(base+'/'+f)
        for m in re.finditer(r'>([^<>]+)<',t):
            if P.search(m.group(1)): res.setdefault(m.group(1),set()).add(base+'/'+f)
def dec(s):
    return s.encode('latin-1','backslashreplace').decode('unicode_escape')
for sd in [x for x in os.listdir(root) if x.startswith('smali')]:
    for d,_,fs in os.walk(os.path.join(root,sd)):
        for f in fs:
            p=os.path.join(d,f); rel=os.path.relpath(p,root)
            if rel.endswith('S4/b.smali'): continue
            for line in open(p,encoding='utf-8'):
                m=re.match(r'\s*const-string(?:/jumbo)? [vp]\d+, "(.*)"\s*$',line)
                if m and '\\u06' in m.group(1):
                    s=dec(m.group(1)); sm.setdefault(s,set()).add(rel)
json.dump({'res':{k:sorted(v) for k,v in res.items()},'smali':{k:sorted(v) for k,v in sm.items()}},open(out,'w',encoding='utf-8'),ensure_ascii=False,indent=1)
print(len(res),len(sm),len(set(res)|set(sm)))
