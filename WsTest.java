import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

public class WsTest {
    public static void main(String[] a) throws Exception {
        String host = "data.tradingview.com";
        String path = "/socket.io/websocket?type=chart&from=2024-01-01";
        SSLSocket sock = (SSLSocket) SSLSocketFactory.getDefault().createSocket(host, 443);
        sock.startHandshake();
        OutputStream os = sock.getOutputStream();
        InputStream in = sock.getInputStream();

        // SAMA macam dalam app — key yang pelik itu
        String key = Base64.getEncoder().encodeToString(
            ("tv" + System.nanoTime()).getBytes(StandardCharsets.UTF_8)).substring(0, 22) + "dGhlIHNhbXBsZQ==";
        System.out.println("WS key: " + key + " (len " + key.length() + ")");

        String req = "GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\n" +
            "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n" +
            "Origin: https://www.tradingview.com\r\nUser-Agent: Mozilla/5.0\r\n\r\n";
        os.write(req.getBytes(StandardCharsets.UTF_8)); os.flush();

        StringBuilder hdr = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            hdr.append((char) c);
            if (hdr.toString().endsWith("\r\n\r\n")) break;
        }
        System.out.println("=== response header ===");
        System.out.println(hdr.toString().trim().split("\r\n")[0]);
        System.out.println("contains 101: " + hdr.toString().contains("101"));

        sock.close();
    }
}
