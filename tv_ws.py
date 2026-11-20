import websocket, json, time
url='wss://data.tradingview.com/socket.io/websocket?type=chart&from=2024-01-01'
ws=websocket.create_connection(url, origin='https://www.tradingview.com', timeout=20, header=['User-Agent: Mozilla/5.0'])
def send(m):
    ws.send('~m~%d~m~%s'%(len(m),m))
send('~h~1'); time.sleep(0.5)
send(json.dumps({'m':'chart_create_session','p':['cs_x','']})); time.sleep(1)
send(json.dumps({'m':'resolve_symbol','p':['cs_x','sds_sym','={\"symbol\":\"NASDAQ:AAPL\",\"adjustment\":\"splits\"}']})); time.sleep(1.5)
send(json.dumps({'m':'create_series','p':['cs_x','sds_sym','s1','sds_1','1D',300,'']})); time.sleep(4)
ws.settimeout(3)
buf=b''
try:
    while len(buf)<3000:
        r=ws.recv()
        buf += r.encode() if isinstance(r,str) else r
except Exception as e:
    print('recv stopped:',type(e).__name__)
print(buf[:2500].decode('utf-8',errors='replace'))
