import re, json
txt=open('raw_frames.txt',encoding='utf-8',errors='replace').read()
frames=re.split(r'~m~\d+~m~', txt)
for f in frames:
    if f.startswith('{"m":"timescale_update"'):
        d=json.loads(f)
        ts=d['p'][1]
        s1=ts.get('s1',{})
        series=s1.get('s',[])
        # count bars
        print('bar count:', len(series))
        print('keys:', list(s1.keys()))
        # show first & last 3 bars
        for b in series[:3]: print('BAR', b)
        for b in series[-3:]: print('BAR', b)
        break
