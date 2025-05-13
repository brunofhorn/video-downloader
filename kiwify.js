const fs = require("fs/promises");
const path = require("path");
const https = require("https");
const http = require("http");
const readline = require("readline");
const { createWriteStream, existsSync } = require("fs");

function escapeFs(str) {
  return str.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

function downloadFileDirect(url, dest) {
  return new Promise((resolve, reject) => {
    if (existsSync(dest)) {
      console.log("    Skipping, file exists.");
      return resolve(false);
    }

    const fileStream = createWriteStream(dest);
    const client = url.startsWith("https") ? https : http;

    client
      .get(url, (response) => {
        if (response.statusCode === 200) {
          response.pipe(fileStream);
          fileStream.on("finish", () => {
            fileStream.close();
            resolve(true);
          });
        } else {
          reject(`Failed to download. Status Code: ${response.statusCode} for URL: ${url}`);
        }
      })
      .on("error", (err) => reject(err));
  });
}

function fetchCourseSections(courseId, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "admin-api.kiwify.com.br",
      path: `/v1/viewer/courses/${courseId}/sections`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Mozilla/5.0",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    });

    req.on("error", (error) => reject(error));
    req.end();
  });
}

async function kiwifyDownload(courseJson) {
  const courseName = escapeFs(courseJson?.course?.name || "downloads");
  const baseDir = path.join("kiwify", courseName);
  await fs.mkdir(baseDir, { recursive: true });

  await fs.writeFile(path.join(baseDir, "course.json"), JSON.stringify(courseJson, null, 2));

  let m = 0;

  async function downModule(modules) {
    for (const module of modules) {
      const moduleName = escapeFs(`${m}_${module.name}`);
      const modulePath = path.join(baseDir, moduleName);

      await fs.mkdir(modulePath, { recursive: true });
      await fs.writeFile(path.join(modulePath, "module.json"), JSON.stringify(module, null, 2));

      console.log(`\nModule '${moduleName}'`);
      const lessons = module.lessons || [];
      const multipleLessons = lessons.length > 1;
      let l = 0;

      for (const lesson of lessons) {
        const lessonName = escapeFs(`${l}_${lesson.title}`);

        // Decide o caminho de salvamento baseado na quantidade de lessons
        const lessonPath = multipleLessons
          ? path.join(modulePath, lessonName)
          : modulePath;

        if (multipleLessons) {
          await fs.mkdir(lessonPath, { recursive: true });
          await fs.writeFile(
            path.join(lessonPath, "lesson.json"),
            JSON.stringify(lesson, null, 2)
          );
        }

        if (lesson.video) {
          console.log(`  Downloading video for '${lessonName}'...`);
          await downloadFileDirect(
            lesson.video.download_link,
            path.join(lessonPath, lesson.video.name)
          );

          if (lesson.video.thumbnail) {
            await downloadFileDirect(
              lesson.video.thumbnail,
              path.join(lessonPath, "thumbnail.png")
            );
          }
        }

        if (lesson.files && lesson.files.length > 0) {
          console.log(`  Downloading files for '${lessonName}'...`);
          for (const f of lesson.files) {
            await downloadFileDirect(
              f.url,
              path.join(lessonPath, f.name)
            );
          }
        }

        if (lesson.content) {
          await fs.writeFile(
            path.join(lessonPath, "content.html"),
            lesson.content
          );
        }

        l++;
      }
      m++;
    }
  }

  if (courseJson?.course?.sections) {
    for (const section of courseJson?.course?.sections) {
      await downModule(section.modules);
    }
  } else if (courseJson?.course?.modules) {
    await downModule(courseJson?.course?.modules);
  } else {
    console.error("❌ Estrutura JSON inválida. Nenhuma seção ou módulo encontrado.");
  }
}

// Entry Point
(async () => {
  const courseId = await askQuestion("📚 Digite o ID do curso: ");
  const token = await askQuestion("🔐 Digite o Authorization Token: ");

  try {
    console.log("\n📡 Buscando dados do curso...");
    const courseJson = await fetchCourseSections(courseId, token);
    console.log("✅ Dados do curso obtidos com sucesso!");

    try {
      await kiwifyDownload(courseJson);
      console.log("\n🎉 Download concluído!");
    } catch (error) {
      console.error("❌ Ocorreu um erro:", error.message || error);
    }
  } catch (err) {
    console.error("❌ Ocorreu um erro:", err.message || err);
  }
})();
