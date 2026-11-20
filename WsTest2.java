import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

public class WsTest2 {
    static InputStream in;
    static OutputStream os;

    public static void main(String[] args) throws Exception {
        String full = "OANDA:XAUUSD";
        SSLSocket sock = (SSLSocket) SSLSocketFactory.getDefault().createSocket("data.tradingview.com", 443);
        sock.startHandshake();
        os = sock.getOutputStream();
        in = sock.getInputStream();

        String key = Base64.getEncoder().encodeToString(
            ("tv" + System.nanoTime()).getBytes(StandardCharsets.UTF_8)).substring(0, 22) + "dGhlIHNhbXBsZQ==";
        String req = "GET /socket.io/websocket?type=chart&from=2024-01-01 HTTP/1.1\r\n" +
            "Host: data.tradingview.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n" +
            "Origin: https://www.tradingview.com\r\nUser-Agent: Mozilla/5.0\r\n\r\n";
        os.write(req.getBytes(StandardCharsets.UTF_8)); os.flush();

        String hdr = readUntil("\r\n\r\n");
        System.out.println("handshake 101: " + hdr.contains("101"));

        // ==== PERSIS seperti app: jsonEscSymbol ==
        String esc = "{\\\"symbol\\\":\\\"" + full + "\\\",\\\"adjustment\\\":\\\"splits\\\"}";
        // dalam Java source di atas: \\\" -> \" dalam string sebenar
        String payload = "{\"m\":\"resolve_symbol\",\"p\":[\"cs_x\",\"sds_sym\",\"=" + esc + "\"]}";
        System.out.println("PAYLOAD: " + payload);

        send("~h~1");
        Thread.sleep(400);
        send("{\"m\":\"chart_create_session\",\"p\":[\"cs_x\",\"\"]}");
        Thread.sleep(600);
        send(payload);
        Thread.sleep(1200);
        send("{\"m\":\"create_series\",\"p\":[\"cs_x\",\"s1\",\"s1\",\"sds_sym\",\"1D\",120,\"\"]}");

        long deadline = System.currentTimeMillis() + 12000;
        boolean gotBars = false;
        while (System.currentTimeMillis() < deadline) {
            String f = readTextFrame();
            if (f == null) break;
            if (f.contains("symbol_error") || f.contains("critical_error")) {
                System.out.println("ERROR FRAME: " + f.substring(0, Math.min(300, f.length())));
            }
            if (f.contains("timescale_update")) {
                gotBars = true;
                System.out.println("GOT timescale_update, len=" + f.length());
                break;
            }
        }
        System.out.println("RESULT gotBars=" + gotBars);
        sock.close();
    }

    static void send(String p) throws Exception {
        String framed = "~m~" + p.length() + "~m~" + p;
        os.write(frameText(framed)); os.flush();
    }

    static byte[] frameText(String text) throws Exception {
        byte[] data = text.getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0x81);
        if (data.length < 126) out.write(0x80 | data.length);
        else if (data.length < 65536) {
            out.write(0x80 | 126);
            out.write((data.length >> 8) & 0xFF);
            out.write(data.length & 0xFF);
        } else {
            out.write(0x80 | 127);
            for (int i = 7; i >= 0; i--) out.write((int)((long)data.length >> (8*i)) & 0xFF);
        }
        byte[] mask = new byte[4];
        new SecureRandom().nextBytes(mask);
        out.write(mask);
        for (int i = 0; i < data.length; i++) out.write(data[i] ^ mask[i & 3]);
        return out.toByteArray();
    }

    static String readTextFrame() throws Exception {
        int b1 = in.read(); if (b1 == -1) return null;
        int b2 = in.read();
        boolean masked = (b2 & 0x80) != 0;
        int len = b2 & 0x7F;
        if (len == 126) len = ((in.read() & 0xFF) << 8) | (in.read() & 0xFF);
        else if (len == 127) {
            long l = 0;
            for (int i = 0; i < 8; i++) l = (l << 8) | (in.read() & 0xFF);
            len = (int) l;
        }
        byte[] mk = null;
        if (masked) { mk = new byte[4]; readFully(mk); }
        byte[] pl = new byte[len];
        readFully(pl);
        if (masked) for (int i = 0; i < len; i++) pl[i] ^= mk[i & 3];
        if ((b1 & 0x0F) == 0x1) return new String(pl, StandardCharsets.UTF_8);
        return "";
    }

    static void readFully(byte[] buf) throws Exception {
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n == -1) throw new Exception("EOF");
            off += n;
        }
    }

    static String readUntil(String delim) throws Exception {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            sb.append((char) c);
            if (sb.length() >= delim.length() &&
                sb.substring(sb.length() - delim.length()).equals(delim)) break;
        }
        return sb.toString();
    }
}
