import argparse
import json
import os
import sys
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--artifact-dir", required=True)
    args = parser.parse_args()

    try:
        from seleniumbase import SB
    except ImportError:
        print(
            "SeleniumBase is not installed. Install requirements-screening.txt.",
            file=sys.stderr,
        )
        return 2

    os.makedirs(args.artifact_dir, exist_ok=True)
    http_status = None
    try:
        request = urllib.request.Request(
            args.url,
            headers={"User-Agent": "DealHunter/0.1 monitor recipe learner"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            http_status = response.status
            source = response.read(150_000)
            with open(
                os.path.join(args.artifact_dir, "http-source.html"), "wb"
            ) as output:
                output.write(source)
    except Exception as error:
        with open(
            os.path.join(args.artifact_dir, "http-error.txt"),
            "w",
            encoding="utf-8",
        ) as output:
            output.write(str(error))

    with SB(browser="chrome", headless=True) as browser:
        browser.open(args.url)
        driver = browser.driver
        title = driver.title or ""
        final_url = driver.current_url
        source = driver.page_source or ""
        try:
            visible_text = driver.find_element("tag name", "body").text
        except Exception:
            visible_text = ""
        with open(
            os.path.join(args.artifact_dir, "dom.html"),
            "w",
            encoding="utf-8",
        ) as output:
            output.write(source)
        with open(
            os.path.join(args.artifact_dir, "visible-text.txt"),
            "w",
            encoding="utf-8",
        ) as output:
            output.write(visible_text)
        browser.save_screenshot(
            os.path.join(args.artifact_dir, "screenshot.png")
        )

    print(
        json.dumps(
            {
                "finalUrl": final_url,
                "httpStatus": http_status,
                "title": title,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
