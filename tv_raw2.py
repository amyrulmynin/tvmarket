import websocket, json, time, re
url='wss://data.tradingview.com/socket.io/websocket?type=chart&from=2024-01-01'
ws=websocket.create_connection(url, origin='https://www.tradingview.com', timeout=20, header=['User-Agent: Mozilla/5.0'])
def send(m):
    ws.send('~m~%d~m~%s'%(len(m),m))
send('~h~1'); time.sleep(0.3)
send(json.dumps({'m':'chart_create_session','p':['cs_x','']})); time.sleep(0.6)
send(json.dumps({'m':'resolve_symbol','p':['cs_x','sds_sym','={\"symbol\":\"NASDAQ:AAPL\",\"adjustment\":\"splits\"}']})); time.sleep(1)
send(json.dumps({'m':'create_series','p':['cs_x','s1','s1','sds_sym','1D',120,'']})); time.sleep(4)
ws.settimeout(5)
buf=b''
try:
    while len(buf)<30000:
        r=ws.recv()
        buf += r.encode() if isinstance(r,str) else r
except Exception:
    pass
open('raw_frames.txt','wb').write(buf)
frames=re.split(r'~m~\d+~m~', buf.decode('utf-8',errors='replace'))
for i,f in enumerate(frames):
    if not f.strip(): continue
    print(i, len(f), f[:80].replace('\n',' '))
