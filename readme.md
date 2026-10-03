# Acode - Official Website Repository

Welcome to the repository for Acode's official website. This project contains the source code and content for [acode.app](https://acode.app), the home of Acode—a powerful and versatile code editor for Android devices.

## About Acode

Acode is a lightweight yet robust code editor designed specifically for Android. It supports a wide range of programming languages, including but not limited to:

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

## Contact

For any inquiries or support, please visit our [contact page](https://acode.app/contact) or reach out via [email](mailto:support@acode.app).

---

_Empower your coding journey with Acode—code anytime, anywhere._
