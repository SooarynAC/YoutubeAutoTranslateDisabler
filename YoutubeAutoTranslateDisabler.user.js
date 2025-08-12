// ==UserScript==
// @name         Youtube Auto-Translate Disabler
// @namespace    https://github.com/SooarynAC/YoutubeAutoTranslateDisabler/
// @version      0.1
// @description  Remove auto-translated youtube titles
// @author       Pierre Couy, Soaryn
// @match        https://www.youtube.com/*
// @grant        GM.setValue
// @grant        GM.getValue
// @require      https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js
// ==/UserScript==

(async () => {
  "use strict";

  /*
    Get a YouTube Data v3 API key from https://console.developers.google.com/apis/library/youtube.googleapis.com?q=YoutubeData
    */
  var NO_API_KEY = false;
  var api_key_awaited = await GM.getValue("api_key");
  if (api_key_awaited === undefined || api_key_awaited === null || api_key_awaited === "") {
    await GM.setValue(
      "api_key",
      prompt(
        "Enter your API key. Go to https://developers.google.com/youtube/v3/getting-started to know how to obtain an API key, then go to https://console.developers.google.com/apis/api/youtube.googleapis.com/ in order to enable Youtube Data API for your key."
      )
    );
  }

  api_key_awaited = await GM.getValue("api_key");
  if (api_key_awaited === undefined || api_key_awaited === null || api_key_awaited === "") {
    NO_API_KEY = true; // Resets after page reload, still allows local title to be replaced
    console.log("NO API KEY PRESENT");
  }
  const API_KEY = await GM.getValue("api_key");
  var API_KEY_VALID = false;
  console.log(API_KEY);

  var url_template = "https://www.googleapis.com/youtube/v3/videos?part=snippet&id={IDs}&key=" + API_KEY;

  var cachedTitles = {}; // Dictionary(id, title): Cache of API fetches, survives only Youtube Autoplay
  var cachedDescriptions = {}; // (id, desc linkified TrustedHTML)

  function getVideoID(a) {
    if (!a) {
      return null;
    }

    //console.log(a)

    while (a.tagName != "A") {
      a = a.parentNode;
    }
    var href = a.href;
    var tmp = href.split("v=")[1];
    return tmp.split("&")[0];
  }

  async function changeTitles() {
    if (NO_API_KEY) {
      return;
    }

    //console.log('CHANGING TITLES...');

    // REFERENCED VIDEO TITLES - find video link elements in the page that have not yet been changed
    var links = Array.prototype.slice.call(document.querySelectorAll("yt-lockup-metadata-view-model h3 a"))
    var links2 = Array.prototype.slice.call(document.querySelectorAll("a#video-title")).filter(el => {
      return !el.href.includes('/shorts/')
    })
    var links3 = Array.prototype.slice.call(document.querySelectorAll("a#video-title-link")).filter(el => {
      return !el.href.includes('/shorts/')
    })
    var spans = Array.prototype.slice.call(document.querySelectorAll("span")).filter((el) => {
      return el.id == "video-title" && !el.className.includes("-radio-") && !el.className.includes("-playlist-");
    });
    links = links.concat(links2);
    links = links.concat(links3);
    links = links.concat(spans);

    // MAIN VIDEO DESCRIPTION - request to load original video description
    var mainVidID = "";
    if (window.location.href.includes("/watch")) {
      mainVidID = window.location.href.split("v=")[1].split("&")[0];
    }

    const IDs = [...links.map((a) => getVideoID(a)), ...(mainVidID ? [mainVidID] : [])];
    const APIFetchIDs = IDs.filter((id) => !cachedTitles[id] || !cachedDescriptions[id]).slice(0, 30);

    //console.log('FETCHED ALL VIDEO IDs...');

    if (links.length > 0 || mainVidID != "") {
      //console.log('SHOULD FETCH TITLES?');
      if (APIFetchIDs.length > 0) {
        //console.log('FETCHING TITLES...');

        var requestUrl = url_template.replace("{IDs}", APIFetchIDs.join(","));

        // Issue API request
        const data = await fetch(requestUrl).then((r) => r.json());
        if (data.kind == "youtube#videoListResponse") {
          API_KEY_VALID = true;

          const items = data.items;

          // Create dictionary for all IDs and their original titles
          items.forEach((v) => {
            cachedTitles[v.id] = v.snippet.title;
            cachedDescriptions[v.id] = DOMPurify.sanitize(linkify(v.snippet.description), {
              RETURN_TRUSTED_TYPE: true,
            });
          });
        } else {
          console.log("API Request Failed!");
          console.log(requestUrl);
          console.log(data);

          // This ensures that occasional fails don't stall the script
          // But if the first query is a fail then it won't try repeatedly
          NO_API_KEY = !API_KEY_VALID;
          if (NO_API_KEY) {
            GM_setValue("api_key", "");
            console.log("API Key Fail! Please Reload!");
          }
        }
      }

      //console.log(cachedTitles);
      //console.log(cachedDescriptions);

      // Begin to update the DOM
      if (mainVidID != "" && location.href.includes("/watch?v=")) {
        // Replace Main Video title
        const mainTitle = document.querySelector("#title > h1 > yt-formatted-string");
        const untranslatedTitle = cachedTitles[mainVidID];
        if (
          mainTitle &&
          untranslatedTitle &&
          (mainTitle.innerText !== untranslatedTitle || mainTitle.getAttribute("is-empty") !== null)
        ) {
          mainTitle.innerText = untranslatedTitle;
          mainTitle.title = untranslatedTitle;
          mainTitle.removeAttribute("is-empty");
          document.title = `${untranslatedTitle} - YouTube`;
        }
        // Replace Main Video Description
        const videoDescription = cachedDescriptions[mainVidID];
        const pageDescription = document.querySelector(
          "#description-inline-expander yt-attributed-string > span"
        );
        // Still critical, since it replaces ALL descriptions, even if it was not translated in the first place (no easy comparision possible)
        if (videoDescription && pageDescription.innerHTML !== videoDescription.toString()) {
          pageDescription.innerHTML = videoDescription;
        }
      }

      // Change all previously found link elements
      for (let i = 0; i < links.length; i++) {
        const curID = getVideoID(links[i]);
        if (curID !== IDs[i]) {
          // Can happen when Youtube was still loading when script was invoked
          console.log("YouTube was too slow again...");
        }
        if (cachedTitles[curID]) {
          const originalTitle = cachedTitles[curID];
          const linkEl = links[i].querySelector("#video-title") || links[i];
          const pageTitle = linkEl.innerText.trim();
          if (pageTitle !== originalTitle.replace(/\s{2,}/g, " ") && pageTitle !== originalTitle) {
            console.log("'" + pageTitle + "' --> '" + originalTitle + "'");
            linkEl.innerText = originalTitle;
            linkEl.title = originalTitle;
          }
        }
      }
    }
  }

  // linkify replaces links correctly, but without redirect or other specific youtube stuff (no problem if missing)
  function linkify(inputText) {
    var replacedText, replacePattern1, replacePattern2, replacePattern3;

    //URLs starting with http://, https://, or ftp://
    replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
    replacedText = inputText.replace(
      replacePattern1,
      '<a class="yt-core-attributed-string__link yt-core-attributed-string__link--call-to-action-color" spellcheck="false" href="$1">$1</a>'
    );

    //URLs starting with "www." (without // before it, or it'd re-link the ones done above).
    replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
    replacedText = replacedText.replace(
      replacePattern2,
      '<a class="yt-core-attributed-string__link yt-core-attributed-string__link--call-to-action-color" spellcheck="false" href="http://$1">$1</a>'
    );

    //Change email addresses to mailto:: links.
    replacePattern3 = /(([a-zA-Z0-9\-\_\.])+@[a-zA-Z\_]+?(\.[a-zA-Z]{2,6})+)/gim;
    replacedText = replacedText.replace(
      replacePattern3,
      '<a class="yt-core-attributed-string__link yt-core-attributed-string__link--call-to-action-color" spellcheck="false" href="mailto:$1">$1</a>'
    );

    replacedText = replacedText.replaceAll("\n", "<br />");

    return replacedText;
  }

  async function wait(milli) {
    await new Promise((r) => setTimeout(r, milli));
  }

  // Run every 5 seconds
  while (true) {
    try {
      await changeTitles();
    } catch (error) {
      console.log(error);
    }

    await wait(5000);
  }
})();
