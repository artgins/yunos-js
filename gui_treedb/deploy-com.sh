#!/bin/sh

NODE="artgins.ytreedb.com"

rsync -avzL --delete \
    --exclude \.webassets-cache --exclude \.sass-cache --exclude \.cache \
    ./dist/ \
    "yuneta@$NODE:/yuneta/gui/$NODE"
