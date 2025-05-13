const fs = require("fs/promises");
const path = require("path");
const { createWriteStream } = require("fs");
const https = require("https");
const http = require("http");
const { existsSync } = require("fs");

function escapeFs(str) {
  return str.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
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
          reject(
            `Failed to download. Status Code: ${response.statusCode} for URL: ${url}`
          );
        }
      })
      .on("error", (err) => reject(err));
  });
}

async function kiwifyDownload(jsonPath, output) {
  const json = await fs.readFile(jsonPath, "utf-8");
  const node = JSON.parse(json);

  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "course.json"), json);

  let m = 0;

  async function downModule(modules) {
    for (const module of modules) {
      const moduleName = escapeFs(`${m}_${module.name}`);
      const modulePath = path.join(output, moduleName);

      await fs.mkdir(modulePath, { recursive: true });
      await fs.writeFile(
        path.join(modulePath, "module.json"),
        JSON.stringify(module)
      );

      console.log(`\nModule '${moduleName}'`);
      let l = 0;

      for (const lesson of module.lessons) {
        const lessonName = escapeFs(`${l}_${lesson.title}`);
        const lessonPath = path.join(modulePath, lessonName);

        await fs.mkdir(lessonPath, { recursive: true });
        await fs.writeFile(
          path.join(lessonPath, "lesson.json"),
          JSON.stringify(lesson)
        );

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
        } else if (lesson.files) {
          console.log(`  Downloading files for '${lessonName}'...`);
          for (const f of lesson.files) {
            await downloadFileDirect(f.url, path.join(lessonPath, f.name));
          }
        } else if (lesson.content) {
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

  if (node.sections) {
    for (const section of node.sections) {
      await downModule(section.modules);
    }
  } else if (node.modules) {
    await downModule(node.modules);
  } else {
    console.error("❌ Estrutura JSON inválida. Nenhuma seção ou módulo encontrado.");
  }
}

// CLI Execution
if (require.main === module) {
  const [jsonPath, output] = process.argv.slice(2);
  if (!jsonPath || !output) {
    console.log("Usage: node index.js <path-to-json> <output-directory>");
    process.exit(1);
  }
  kiwifyDownload(jsonPath, output);
}
