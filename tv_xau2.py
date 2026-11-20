import websocket, json, time, re
ws=websocket.create_connection('wss://data.tradingview.com/socket.io/websocket?type=chart&from=2024-01-01', origin='https://www.tradingview.com', timeout=20, header=['User-Agent: Mozilla/5.0'])
def send(m):
    ws.send('~m~%d~m~%s'%(len(m),m))
send('~h~1'); time.sleep(0.3)
send(json.dumps({'m':'chart_create_session','p':['cs_x','']})); time.sleep(0.5)
send(json.dumps({'m':'resolve_symbol','p':['cs_x','sds_sym','={\"symbol\":\"OANDA:XAUUSD\",\"adjustment\":\"splits\"}']})); time.sleep(2)
send(json.dumps({'m':'create_series','p':['cs_x','s1','s1','sds_sym','1D',120,'']})); time.sleep(5)
ws.settimeout(5)
buf=b''
try:
    while len(buf)<30000:
        r=ws.recv()
        buf += r.encode() if isinstance(r,str) else r
except Exception:
    pass
txt=buf.decode('utf-8',errors='replace')
frames=re.split(r'~m~\d+~m~', txt)
for f in frames:
    if not f.strip(): continue
    print(len(f), f[:90].replace('\n',' '))
    if 'timescale_update' in f:
        d=json.loads(f)
        s=d['p'][1]['s1']['s']
        print('  BARS:', len(s), 'last close:', s[-1]['v'][4])
