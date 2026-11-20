import websocket, json, time, re
def run(sym):
    ws=websocket.create_connection('wss://data.tradingview.com/socket.io/websocket?type=chart&from=2024-01-01',
        origin='https://www.tradingview.com', timeout=15, header=['User-Agent: Mozilla/5.0'])
    def send(m): ws.send('~m~%d~m~%s'%(len(m),m))
    send('~h~1'); time.sleep(0.3)
    send(json.dumps({'m':'chart_create_session','p':['cs_x','']})); time.sleep(0.5)
    send(json.dumps({'m':'resolve_symbol','p':['cs_x','sds_sym','={"symbol":"%s","adjustment":"splits"}'%sym]}))
    time.sleep(2)
    send(json.dumps({'m':'create_series','p':['cs_x','s1','s1','sds_sym','1D',120,'']}))
    ws.settimeout(3)
    buf=b''
    t0=time.time()
    while time.time()-t0 < 14:
        try:
            r=ws.recv()
        except Exception:
            break
        buf += r.encode() if isinstance(r,str) else r
        if b'timescale_update' in buf or b'series_completed' in buf:
            break
    txt=buf.decode('utf-8',errors='replace')
    for f in re.split(r'~m~\d+~m~', txt):
        if 'timescale_update' in f:
            d=json.loads(f)
            s=d['p'][1]['s1']['s']
            print(sym,'BARS:',len(s),'last:',s[-1]['v'])
            return
        if 'symbol_error' in f or 'critical_error' in f:
            print(sym,'ERROR:',f[:200])
            return
    print(sym,'no data, frames:',[f[:60] for f in re.split(r'~m~\d+~m~',txt) if f.strip()][:6])
run('OANDA:XAUUSD')
