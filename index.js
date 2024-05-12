const { Client } = require("@notionhq/client");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");
const NotionPageToHtml = require("notion-page-to-html");
const fs = require("fs");
const minify = require("html-minifier").minify;

require("dotenv").config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });

function convertToSlug(Text) {
	if (!Text) return undefined;
	return Text.toLowerCase()
		.replace(/ /g, "-")
		.replace(/[^\w-]+/g, "");
}

async function getAllDatabaseItems(databaseId) {
	let items = [];
	let cursor = undefined;

	do {
		const response = await notion.databases.query({
			database_id: databaseId,
			start_cursor: cursor,
			page_size: 100, // You can fetch up to 100 items per request
		});

		items = items.concat(response.results);
		cursor = response.next_cursor;
	} while (cursor);

	return items;
}

const getCsvWriter = async (index) => {
	const csvPath = path.join(__dirname + "/exports/", `notion-export-${index}.csv`);
	return await createObjectCsvWriter({
		path: csvPath,
		header: [
			{ id: "title", title: "Title" },
			{ id: "name", title: "Name" },
			{ id: "slug", title: "Slug" },
			{ id: "content", title: "Content" },
			{ id: "Excerpt", title: "Excerpt" },
			{ id: "Related Posts", title: "Related Posts" },
			{ id: "Do not index", title: "Do not index" },
			{ id: "Last Edited Time", title: "Last Edited Time" },
			{ id: "Extra Info", title: "Extra Info" },
			{ id: "Ready to Publish", title: "Ready to Publish" },
			{ id: "Hide CTA", title: "Hide CTA" },
			{ id: "Hide Cover", title: "Hide Cover" },
			{ id: "Meta Description", title: "Meta Description" },
			{ id: "Meta Title", title: "Meta Title" },
			{ id: "Hide in Main Feed", title: "Hide in Main Feed" },
			{ id: "Featured", title: "Featured" },
			{ id: "Tags", title: "Tags" },
			{ id: "Publish Date", title: "Publish Date" },
			{ id: "Authors", title: "Authors" },
		],
	});
};

async function importPages() {
	// main database with core database entries
	let pages = await getAllDatabaseItems(process.env.CONTENT_DATABASE_ID);

	console.log("pages length", pages?.length);

	// example linked databases
	let authors = await getAllDatabaseItems(process.env.AUTHORS_DATABASE_ID);
	let tags = await getAllDatabaseItems(process.env.TAGS_DATABASE_ID);

	let pagesData;

	let pageList = await pages.map(async (page) => {
		let html = ``;

		const htmlPath = __dirname + `/data/${page.id}-html.json`;

		try {
			if (fs.existsSync(htmlPath)) {
				const data = fs.readFileSync(htmlPath, "utf8");

				html = await minify(JSON.parse(data)?.html, {
					removeAttributeQuotes: true,
					collapseWhitespace: true,
					removeComments: true,
					minifyJS: true,
					minifyCSS: true,
				});
			} else {
				const pageHtml = await NotionPageToHtml.convert(page.url);

				if (pageHtml) {
					html = minify(pageHtml?.html, {
						removeAttributeQuotes: true,
						collapseWhitespace: true,
						removeComments: true,
						minifyJS: true,
						minifyCSS: true,
					});
					fs.writeFile(htmlPath, JSON.stringify({ html }, null, 2), (err) => {
						console.log("err is ", err);
					});
				}
			}
		} catch (err) {
			console.log("err getting html", err);
		}

		const extractText = (item) => {
			if (!item || !item[0] || !item[0].plain_text) return "";
			return item[0].plain_text;
		};

		const extractRelations = ({ relationData, table, path = "", extract }) => {
			if (!relationData) return [];

			let relations = [];
			relationData.forEach((rel) => {
				let plainText = table?.filter((page) => page.id === rel?.id)?.[0]?.properties?.Slug?.rich_text?.[0]?.plain_text;

				if (!plainText) {
					// fall back to autocreate slug not defined yet
					plainText = convertToSlug(table?.filter((page) => page.id === rel?.id)?.[0]?.properties?.Name?.title?.[0]?.plain_text);
				}

				relations.push(path + plainText);
			});

			return relations.join(", ");
		};

		const checkboxValue = (checkboxData) => {
			return checkboxData ? checkboxData.checkbox : false;
		};

		const extractDate = (dateData) => {
			if (!dateData || !dateData.start) return null;
			return dateData?.start;
		};

		try {
			return {
				name: extractText(page.properties.Name.title),
				title: extractText(page.properties.Name.title),
				slug: extractText(page.properties.Slug.rich_text),
				content: html,
				Excerpt: extractText(page.properties.Excerpt.rich_text),
				"Do not index": checkboxValue(page.properties["Do not index"].checkbox),
				"Last Edited Time": page.properties["Last Edited Time"].last_edited_time,
				"Extra Info": extractRelations(page.properties["Extra Info"].multi_select),
				"Ready to Publish": checkboxValue(page.properties["Ready to Publish"].checkbox),
				"Hide CTA": checkboxValue(page.properties["Hide CTA"].checkbox),
				"Hide Cover": checkboxValue(page.properties["Hide Cover"].checkbox),
				"Meta Description": extractText(page.properties["Meta Description"].rich_text),
				"Meta Title": extractText(page.properties["Meta Title"].rich_text),
				"Hide in Main Feed": checkboxValue(page.properties["Hide in Main Feed"].checkbox),
				Featured: checkboxValue(page.properties.Featured.checkbox),
				Tags: extractRelations({ relationData: page.properties["Tags"].relation, table: tags, path: "/tags/" }),
				"Publish Date": extractDate(page.properties["Publish Date"].date),
				Authors: extractRelations({ relationData: page.properties["Authors"].relation, table: authors, path: "/authors/" }),
			};
		} catch (err) {
			console.log("Error getting data from page:", err);
		}
	});

	pagesData = await Promise.all(pageList);

	let csvWriter = await getCsvWriter(0);

	const files = fs.readdirSync("exports", { withFileTypes: true });
	files.forEach((file) => {
		const filepath = path.join("exports/", file.name);
		if (file.isDirectory()) {
			deleteFolderContentsSync(filepath);
			fs.rmdirSync(filepath);
		} else {
			fs.unlinkSync(filepath);
		}
	});

	console.log("Exported pages count:", pagesData?.length);
	for (const page of pagesData) {
		csvWriter = await getCsvWriter(page.title);
		await csvWriter.writeRecords([page]);
	}
}

importPages();
