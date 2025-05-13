const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const fs = require("fs");
const readline = require("readline");

const debug = false;
const debug_data = [];
const subtitle_lang = "pt";

async function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

(async () => {
  const course_url = await askQuestion("📚 Insira a URL do curso: ");
  const token = await askQuestion("🔐 Insira o Token (cookie): ");
  const accessToken = await askQuestion("🔐 Insira o Access Token: ");
  const refreshToken = await askQuestion("♻️ Insira o Refresh Token: ");

  const cookies = [
    { name: "_domestika_session", value: token, domain: "www.domestika.org" },
  ];

  const _credentials_ = `{%22accessToken%22:%22${accessToken}%22%2C%22refreshToken%22:%22${refreshToken}%22%2C%22isEmpty%22:false}`;
  const regex_token = /accessToken\":\"(.*?)\"/gm;
  const access_token = regex_token.exec(decodeURI(_credentials_))[1];

  if (!fs.existsSync("N_m3u8DL-RE.exe")) {
    throw Error("N_m3u8DL-RE.exe not found! Download it from https://github.com/nilaoda/N_m3u8DL-RE/releases");
  }

  await scrapeSite(course_url, cookies, access_token);
})();

async function scrapeSite(course_url, cookies, access_token) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(0);
  await page.setCookie(...cookies);

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (["stylesheet", "font", "image"].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.goto(course_url);
  const html = await page.content();
  const $ = cheerio.load(html);

  console.log("Scraping Site");

  const units = $("h4.h2.unit-item__title a");
  const title = $("h1.course-header-new__title")
    .text()
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-");

  const regex_final = /courses\/(.*?)-*\/final_project/gm;

  const final_project_id = units
    .map((i, element) => {
      const href = $(element).attr("href");
      const match = regex_final.exec(href);
      return match ? match[1].split("-")[0] : null;
    })
    .get();

  const filteredUnits = units.filter((i, element) => {
    const href = $(element).attr("href");
    return !regex_final.exec(href);
  });

  console.log(filteredUnits.length + " Units Detected");

  let allVideos = [];
  for (let i = 0; i < filteredUnits.length; i++) {
    const videoData = await getInitialProps($(filteredUnits[i]).attr("href"), page);
    allVideos.push({
      title: $(filteredUnits[i])
        .text()
        .replaceAll(".", "")
        .trim()
        .replace(/[/\\?%*:|"<>]/g, "-"),
      videoData,
    });
  }

  console.log("All Videos Found");

  if (final_project_id) {
    console.log("Fetching Final Project");
    let final_data = await fetchFromApi(
      `https://api.domestika.org/api/courses/${final_project_id}/final-project?with_server_timing=true`,
      "finalProject.v1",
      access_token
    );

    if (final_data?.data?.relationships?.video?.data?.id) {
      const final_video_id = final_data.data.relationships.video.data.id;
      final_data = await fetchFromApi(
        `https://api.domestika.org/api/videos/${final_video_id}?with_server_timing=true`,
        "video.v1",
        access_token
      );

      allVideos.push({
        title: "Final project",
        videoData: [
          {
            playbackURL: final_data.data.attributes.playbackUrl,
            title: "Final project",
            section: "Final project",
          },
        ],
      });
    }
  }

  let count = 0;
  let downloadPromises = [];
  for (const unit of allVideos) {
    for (let a = 0; a < unit.videoData.length; a++) {
      const vData = unit.videoData[a];
      downloadPromises.push(downloadVideo(vData, title, unit.title, a));
      count++;
      console.log(`Download ${count}/${allVideos.length} Started`);
    }
  }

  await Promise.all(downloadPromises);

  await page.close();
  await browser.close();

  if (debug) {
    fs.writeFileSync("log.json", JSON.stringify(debug_data));
    console.log("Log File Saved");
  }

  console.log("🎉 Todos os vídeos foram baixados!");
}

async function getInitialProps(url, page) {
  await page.goto(url);

  const data = await page.evaluate(() => window.__INITIAL_PROPS__);
  const html = await page.content();
  const $ = cheerio.load(html);

  const section = $("h2.h3.course-header-new__subtitle")
    .text()
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-");

  const videoData = [];

  if (data?.videos?.length > 0) {
    for (const el of data.videos) {
      videoData.push({
        playbackURL: el.video.playbackURL,
        title: el.video.title.replaceAll(".", "").trim(),
        section,
      });
      console.log("Video Found: " + el.video.title);
    }
  }

  return videoData;
}

async function fetchFromApi(apiURL, accept_version, access_token) {
  const response = await fetch(apiURL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${access_token}`,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      "x-dmstk-accept-version": accept_version,
    },
  });

  if (!response.ok) {
    console.log("Error Fetching Data. Check if credentials are valid.");
    return false;
  }

  try {
    return await response.json();
  } catch (error) {
    console.log(error);
    return false;
  }
}

async function downloadVideo(vData, title, unitTitle, index) {
  const outputDir = `domestika_courses/${title}/${vData.section}/${unitTitle}/`;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const options = { maxBuffer: 1024 * 1024 * 10 };
  const baseCmd = `N_m3u8DL-RE "${vData.playbackURL}" --save-dir "${outputDir}" --save-name "${index}_${vData.title.trimEnd()}"`;

  try {
    await exec(`${baseCmd} -sv res="1080*":codec=hvc1:for=best`, options);
    await exec(`${baseCmd} --auto-subtitle-fix --sub-format SRT --select-subtitle lang="${subtitle_lang}":for=all`, options);

    if (debug) {
      debug_data.push({
        videoURL: vData.playbackURL,
        output: ["Downloaded Successfully"],
      });
    }

    console.log(`✅ Downloaded: ${vData.title}`);
  } catch (error) {
    console.error(`❌ Error downloading video: ${error}`);
  }
}
