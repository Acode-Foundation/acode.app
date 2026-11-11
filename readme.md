# Acode - Official Website Repository

Welcome to the repository for Acode's official website. This project contains the source code and content for [acode.app](https://acode.app), the home of Acode - a powerful and versatile code editor for Android/IOS devices.

## About Acode

Acode is a lightweight yet robust code editor designed specifically for Android/IOS. It supports a wide range of programming languages, including but not limited to:

- HTML
- JavaScript
- Python
- Java
- CSS
- Dart

With Acode, you can:

- Edit and create websites, and instantly preview them in a browser.
- Seamlessly modify source files for various languages.
- Utilize GitHub integration for efficient version control.
- Manage files via FTP/SFTP support.
- Enjoy syntax highlighting for over 100 programming languages.
- Customize the interface with multiple themes.
- Use the in-app preview for HTML and Markdown files.
- Debug using the integrated JavaScript console.
- Enhance functionality with a collection of over 195 plugins.
- Agentic development, multi pane and many more.

For more details, visit the [Acode website](https://acode.app).

## Repository Structure

This repository is organized as follows:

- `/client`: Contains the React components and logic for the website.
- `/server`: Includes the backend code for handling API requests and server-side logic.
- `/public`: Houses static assets, built files and the main HTML files.
- `/dev`: Contains development scripts and tools.
- `/cron-jobs/`: Includes scripts for scheduled tasks and maintenance.

## Plugin security scanning

Uploaded plugins are checked with [plugin_scanner](https://github.com/Acode-Foundation/plugin_scanner):

- **New plugins** are scanned on upload. The verdict is stored and shown to admins on the plugin's **Security** tab. They still need admin approval as before.
- **Updates to published plugins** go to `data/plugins/pending/` first, and the scanner compares them with the live zip. If nothing risky was added, the update goes live straight away. Otherwise it is held until an admin approves or rejects it under **Admin → Plugin updates**. Users keep the live version meanwhile, and the developer is emailed either way.
- If the scanner is missing or fails, updates are held (fail closed).

Install the scanner on the server and point `PLUGIN_SCANNER_BIN` at it (defaults to `plugin_scanner` on `PATH`):

```sh
git clone https://github.com/Acode-Foundation/plugin_scanner
cd plugin_scanner && cargo build --release
sudo install -m 755 target/release/plugin_scanner /usr/local/bin/plugin_scanner
```

Scan results are stored in the `plugin_scan` table, one row per upload.

## Contributing

We welcome contributions to improve the Acode website. To contribute:

1. Fork this repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and ensure they are well-tested.
4. Submit a pull request with a clear description of your changes.

Please adhere to our [Code of Conduct](CODE_OF_CONDUCT.md) in all interactions.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

### Private access to dev.acode.app

Both `dev.acode.app` and `go.dev.acode.app` proxy to the reverse SSH tunnel on port 3333. Edit the site file enabled as `/etc/nginx/sites-enabled/dev.acode.app`. Paste these directives inside **each existing HTTPS `server` block**, immediately after `server_name` and before any redirect. Keep each block's existing certificate and `proxy_pass` directives.

```nginx
if ($realip_remote_addr !~ "^(127[.]0[.]0[.]1|::1|::ffff:(127[.]0[.]0[.]1|7f00:1))$") {
    return 403;
}

add_header X-Robots-Tag "noindex, nofollow" always;
```

The rule checks the TCP peer and requires Nginx's HTTP real-IP module. If a location sets its own `add_header`, repeat the robots header there.

Development promotion links on `go.dev.acode.app` are for testing through the tunnel. External requests to that hostname should receive 403. Public promotions use `go.acode.app`. Both tracking proxies pass the original hostname to Express with `proxy_set_header Host $http_host;`. Ordinary page and asset URLs redirect to the matching site with their path and query intact. GET and HEAD requests to API, OAuth and app-association paths return 404 on the tracking hosts. OPTIONS returns 204. Other methods return 405.

Both certificate lineages use Certbot's Nginx authenticator. In the same site file, replace the existing HTTP redirects for these two hostnames with the block below. If the old HTTP block also serves other hostnames, keep their configuration and remove only the two dev names from that block.

```nginx
server {
    listen 80;
    server_name dev.acode.app go.dev.acode.app;
    location / {
        return 403;
    }
}
```

Match the server's IPv6 listener if the hostnames publish IPv6. Keep the 403 inside `location /` so Certbot can temporarily serve its exact HTTP-01 token location during renewal.

Keep the reverse forward bound to loopback and add a local forward to reach HTTPS, for example `ssh -N -o ExitOnForwardFailure=yes -R 127.0.0.1:3333:localhost:3031 -L 127.0.0.1:8443:127.0.0.1:443 <ssh-host>`. If the reverse forward is already running, add only the local forward in another connection. Test with `curl --connect-to dev.acode.app:443:127.0.0.1:8443 https://dev.acode.app/`. Browser or native OAuth callbacks that require the original origin also need the dev hostname routed through the tunnel on port 443.

Before changing Nginx, run `sudo certbot renew --cert-name dev.acode.app --dry-run` and repeat for `go.dev.acode.app` to verify current renewal. After editing the site file, inspect the server blocks with `sudo nginx -T`, then run `sudo nginx -t && sudo systemctl reload nginx`. After reload, repeat both renewal checks against the new configuration. With the tunnel up, use `ss -lnt 'sport = :3333'` on the SSH server to confirm it listens only on loopback. Verify the app through the local forward and confirm external HTTP and HTTPS requests to both names return 403. Recheck external access with the tunnel stopped and confirm production still responds normally. Use Search Console prefix removal for any indexed dev hostname once the restriction is live.

---

_Empower your coding journey with Acode—code anytime, anywhere._
