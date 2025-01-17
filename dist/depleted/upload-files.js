import fs from "fs";
import path from "path";
import OpenAI from "openai";
const openai = new OpenAI();
// Helper function to read all files in directories
async function getAllFilesFromDirectories(directories) {
    let filePaths = [];
    for (const directory of directories) {
        const files = fs.readdirSync(directory, { withFileTypes: true });
        for (const file of files) {
            const fullPath = path.join(directory, file.name);
            if (file.isFile())
                filePaths.push(fullPath);
        }
    }
    return filePaths;
}
// Function to upload files in batches
async function uploadFilesToVectorStore(directories, batchSize) {
    try {
        // Step 1: Get all files from directories
        const filePaths = await getAllFilesFromDirectories(directories);
        console.log(`Found ${filePaths.length} files to upload.`);
        // Step 2: Create the vector store
        const vectorStore = await openai.beta.vectorStores.create({
            name: "Financial Statement",
        });
        console.log("Vector Store created with ID:", vectorStore.id);
        // Step 3: Upload files in batches
        for (let i = 0; i < filePaths.length; i += batchSize) {
            const batch = filePaths.slice(i, i + batchSize).map((filePath) => fs.createReadStream(filePath));
            console.log(`Uploading batch ${Math.floor(i / batchSize) + 1} with ${batch.length} files...`);
            try {
                await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, batch);
                console.log(`Batch ${Math.floor(i / batchSize) + 1} uploaded successfully.`);
            }
            catch (batchError) {
                console.error(`Error uploading batch ${Math.floor(i / batchSize) + 1}:`, batchError);
            }
        }
        console.log("All files uploaded and processed.");
    }
    catch (error) {
        console.error("Error during file upload process:", error);
    }
}
// Main function
async function main() {
    const directories = ["ten_digit", "six_digit"]; // Adjust paths as needed
    const batchSize = 20; // Reduced batch size to avoid API errors
    await uploadFilesToVectorStore(directories, batchSize);
}
main();
