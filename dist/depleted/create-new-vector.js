import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Use the API key from your .env file
});
async function createNewVectorStoreAndUploadFiles() {
    try {
        // Step 1: Specify the file paths to upload
        const filePaths = ["4_digit.json", "6_digit.json", "10_digit.json"]; // Replace with your file paths
        const fileStreams = filePaths.map((filePath) => fs.createReadStream(filePath));
        // Step 2: Create a new vector store
        const vectorStore = await openai.beta.vectorStores.create({
            name: "New Financial Statements", // Give your vector store a meaningful name
        });
        console.log("Vector store created with ID:", vectorStore.id);
        // Step 3: Upload files to the new vector store
        console.log("Uploading files to vector store...");
        await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, fileStreams);
        console.log("Files uploaded successfully to the new vector store:", vectorStore.id);
        return vectorStore.id;
    }
    catch (error) {
        console.error("Error creating vector store or uploading files:", error);
        throw error;
    }
}
// Execute the function
createNewVectorStoreAndUploadFiles();
