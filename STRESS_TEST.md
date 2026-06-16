# Stress Testing Guide

Steps to run a user stress test against a copy of the app without touching production data.

## Setup

1. **Copy the Google Sheet**
   - Open the production spreadsheet
   - File -> Make a copy
   - This copies all tabs, data, and the bound Apps Script automatically

2. **Deploy the copied Apps Script**
   - Open the copied Sheet
   - Extensions -> Apps Script
   - Deploy -> New deployment -> Web App
   - Set access to "Anyone" (same as production)
   - Copy the generated deployment URL (`https://script.google.com/macros/s/.../exec`)

3. **Swap the URL in the frontend**
   - In `js/common.js`, line 1, replace `WEB_APP_URL` with the test deployment URL
   - The production URL is: `https://script.google.com/macros/s/AKfycbxrQdQGqbBTELWm7huWChdbES0ry7WFZetlELWuEdI0T6lfbXEzrqx9Vo5yA-b9dW4y7A/exec`

4. **Share with testers**
   - Have testers open the app from its GitHub Pages URL (or serve locally) with the swapped URL
   - All reads and writes go to the copied Sheet — production data is untouched

## Cleanup

- Revert `WEB_APP_URL` in `js/common.js` back to the production URL when done
- Delete the copied Sheet and its Apps Script deployment if no longer needed
