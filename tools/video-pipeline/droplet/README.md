# Automatic Alice renderer on the droplet (CK-7728)

Runs `tools/video-pipeline/build_short.py` by itself on a server, so Shorts with Alice's voice get rendered even when
nobody's laptop is on. **Rendering only: it never uploads or publishes anything.**

## How it works
- A systemd timer starts the job at about 00:15, 06:15, 12:15 and 18:15 UTC (`Persistent`: if the machine was off it catches up).
- The job fast-forwards its clone of the repo to `main`, then renders every `video-scripts/*.json` that is new or changed since
  the last render (it remembers each script's SHA-256). **Only scripts that reached `main` through a reviewed pull request are rendered.**
- Output (MP4, SRT, thumbnail) goes to `/var/lib/alice-render/out`. A person watches each video and publishes by hand.
- Runs as an unprivileged user (`alice-render`), low priority, 3 GB memory cap, sandboxed to its own folders, so it does not
  disturb other services on the droplet.

## Set up (once)
```
git clone https://github.com/MyPrivacyTOOL/myprivacytool && cd myprivacytool
sudo bash tools/video-pipeline/droplet/install.sh
sudo install -o alice-render -g alice-render -m 0640 /path/to/alice.png /var/lib/alice-render/alice.png   # approved drawing (MPC-7401)
sudo systemctl start alice-render.service        # run once now, then watch: journalctl -u alice-render.service -f
```

## Not in scope
This is not a live voice service for the website. The site says Alice's voice is the visitor's own device and nothing is
sent to us; serving Alice's voice from a server would change that and needs its own decision, privacy wording and legal review.

## Alice's picture
By default it uses the text-free reference in the repo (`video-scripts/assets/alice.png`, 820 px wide, so slightly soft when
enlarged). When a full-size text-free drawing exists (MPC-7401), install it as `/var/lib/alice-render/alice.png` and it takes priority:
`install -o alice-render -g alice-render -m 0640 /path/to/alice.png /var/lib/alice-render/alice.png`.
Scripts are re-rendered only when they change; to re-render everything after changing the picture: `rm /var/lib/alice-render/state/*`
then `systemctl start alice-render.service`.
