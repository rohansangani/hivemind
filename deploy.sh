#!/bin/bash
# Merge sushantprod → main and deploy to live

git checkout main
git merge sushantprod
git push origin main
git checkout sushantprod

echo "✅ Deployed to live. Vercel will update hivemind.clickpost.io in ~1 min."
