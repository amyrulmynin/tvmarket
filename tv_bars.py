import websocket, json, time
url='wss://data.tradingview.com/socket.io/websocket?type=chart&from=2024-01-01'
ws=websocket.create_connection(url, origin='https://www.tradingview.com', timeout=20, header=['User-Agent: Mozilla/5.0'])
def send(m):
    ws.send('~m~%d~m~%s'%(len(m),m))
send('~h~1'); time.sleep(0.3)
send(json.dumps({'m':'chart_create_session','p':['cs_x','']})); time.sleep(0.6)
send(json.dumps({'m':'resolve_symbol','p':['cs_x','sds_sym','={\"symbol\":\"NASDAQ:AAPL\",\"adjustment\":\"splits\"}']})); time.sleep(1)
send(json.dumps({'m':'create_series','p':['cs_x','sds_sym','s1','sds_1','1D',120,'']})); time.sleep(3)
ws.settimeout(4)
buf=b''
try:
    while len(buf)<6000:
        r=ws.recv()
        buf += r.encode() if isinstance(r,str) else r
except Exception as e:
    pass
txt=buf.decode('utf-8',errors='replace')
# find the 'du' data-update message which holds bars
import re
# split frames
frames=re.split(r'~m~\d+~m~', txt)
for f in frames:
    if f.startswith('{"m":"du"') or f.startswith('{"m":"timescale_update"') or f.startswith('{"m":"series_completed"'):
        print(f[:1800])
        print('---FRAME-END---')
