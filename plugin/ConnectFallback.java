// Repro for the broken-IPv6 blank screen (Couriel, 2026-09-26).
//
// DNS hands OkHttp two addresses: first one blackholed (never answers, never
// refuses — like a router that advertises IPv6 but drops it), second one good.
// OkHttp 4.x walks addresses serially and only moves on when a connect FAILS.
// With React Native's default connectTimeout(0) it waits on the first forever.
//
// Usage: java -cp <okhttp+okio+kotlin jars> ConnectFallback.java <connectTimeoutSeconds>
// Exit 0 = got the response via the second address, 1 = gave up (hang).
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.concurrent.TimeUnit;
import com.sun.net.httpserver.HttpServer;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class ConnectFallback {
  public static void main(String[] args) throws Exception {
    long connectTimeout = Long.parseLong(args[0]);

    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", ex -> {
      byte[] ok = "ok".getBytes();
      ex.sendResponseHeaders(200, ok.length);
      ex.getResponseBody().write(ok);
      ex.close();
    });
    server.start();
    int port = server.getAddress().getPort();

    // Same shape as OkHttpClientProvider.createClientBuilder(), with the one knob under test.
    OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(connectTimeout, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(0, TimeUnit.MILLISECONDS)
        .callTimeout(15, TimeUnit.SECONDS) // the test's own patience, not the app's
        .dns(host -> List.of(
            InetAddress.getByName("10.255.255.1"), // blackhole
            InetAddress.getByName("127.0.0.1")))
        .build();

    long t0 = System.nanoTime();
    int code = 1;
    try (Response r = client.newCall(new Request.Builder().url("http://probe.test:" + port + "/").build()).execute()) {
      System.out.println("connectTimeout=" + connectTimeout + "s -> HTTP " + r.code());
      code = r.code() == 200 ? 0 : 1;
    } catch (Exception e) {
      System.out.println("connectTimeout=" + connectTimeout + "s -> " + e);
    }
    System.out.printf("elapsed %.1fs%n", (System.nanoTime() - t0) / 1e9);
    server.stop(0);
    System.exit(code);
  }
}
