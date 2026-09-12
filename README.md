# Project BAKEBAKE — website

Static site for bakebake.org. Pages are generated from `build.py`:

```
python build.py
```

Edit content in `build.py`, run it, commit the generated HTML. JA pages at the root, EN pages under `en/`.

GitHub Pages publishes the root of `main` in `Suke-go/bakebake` to https://bakebake.org/.
Push website updates to this repository and confirm the `pages build and deployment` run succeeds.
The `site/` copy in `Suke-go/bakebake-generator` is not the Pages source.
Keep `CNAME` and `.nojekyll` when synchronizing website files.
