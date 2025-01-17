import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
// Helper function to upload a single file with retries
async function uploadFileWithRetry(filePath, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const file = await openai.files.create({
                file: fs.createReadStream(filePath),
                purpose: "assistants"
            });
            console.log(`Successfully uploaded ${path.basename(filePath)} with ID: ${file.id}`);
            return file.id;
        }
        catch (error) {
            console.error(`Attempt ${attempt} failed for ${path.basename(filePath)}:`, error.message);
            if (attempt === maxRetries) {
                console.error(`Failed to upload ${path.basename(filePath)} after ${maxRetries} attempts`);
                return null;
            }
            // Exponential backoff
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
            console.log(`Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}
async function createVectorStoreWithFiles() {
    try {
        // Get all files from both directories
        const sixDigitPath = path.join(__dirname, '../../data/six_digit');
        const tenDigitPath = path.join(__dirname, '../../data/ten_digit');
        const sixDigitFiles = await getJsonFiles(sixDigitPath);
        const tenDigitFiles = await getJsonFiles(tenDigitPath);
        const allFilePaths = [...sixDigitFiles, ...tenDigitFiles];
        console.log(`Found ${allFilePaths.length} files to process`);
        // Process files in smaller batches
        const BATCH_SIZE = 20; // Reduced batch size
        const fileIds = [];
        let successCount = 0;
        let failCount = 0;
        for (let i = 0; i < allFilePaths.length; i += BATCH_SIZE) {
            const batch = allFilePaths.slice(i, i + BATCH_SIZE);
            console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(allFilePaths.length / BATCH_SIZE)}`);
            // Upload files in batch with retries
            const batchResults = await Promise.all(batch.map(filePath => uploadFileWithRetry(filePath)));
            const validIds = batchResults.filter(id => id !== null);
            fileIds.push(...validIds);
            successCount += validIds.length;
            failCount += (batch.length - validIds.length);
            console.log(`Batch progress: ${successCount} successful, ${failCount} failed`);
            // Add longer delay between batches
            if (i + BATCH_SIZE < allFilePaths.length) {
                console.log('Waiting 5 seconds before next batch...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        console.log(`\nUpload complete: ${successCount} successful, ${failCount} failed`);
        if (fileIds.length === 0) {
            throw new Error('No files were successfully uploaded');
        }
        // Create vector store
        console.log('\nCreating vector store...');
        let vectorStore = await openai.beta.vectorStores.create({
            name: "Indonesian HS Codes"
        });
        console.log('Created vector store:', vectorStore.id);
        // Add files to vector store in smaller batches
        const VECTOR_BATCH_SIZE = 10;
        for (let i = 0; i < fileIds.length; i += VECTOR_BATCH_SIZE) {
            const batch = fileIds.slice(i, i + VECTOR_BATCH_SIZE);
            console.log(`\nAdding batch ${Math.floor(i / VECTOR_BATCH_SIZE) + 1} of ${Math.ceil(fileIds.length / VECTOR_BATCH_SIZE)} to vector store`);
            try {
                const result = await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, { files: batch });
                console.log('Batch status:', result.status);
                console.log('File counts:', result.file_counts);
            }
            catch (error) {
                console.error('Error adding batch to vector store:', error.message);
                // Continue with next batch
            }
            // Add delay between vector store batches
            if (i + VECTOR_BATCH_SIZE < fileIds.length) {
                console.log('Waiting 3 seconds before next vector store batch...');
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
        return {
            vectorStoreId: vectorStore.id,
            fileIds: fileIds,
            successCount,
            failCount
        };
    }
    catch (error) {
        console.error('Error in vector store creation:', error);
        throw error;
    }
}
// Helper function to get JSON files from a directory
async function getJsonFiles(directory) {
    const files = [];
    async function scanDirectory(dir) {
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await scanDirectory(fullPath);
                }
                else if (entry.isFile() && path.extname(entry.name) === '.json') {
                    files.push(fullPath);
                }
            }
        }
        catch (error) {
            console.error(`Error scanning directory ${dir}:`, error);
        }
    }
    await scanDirectory(directory);
    return files;
}
// Execute
console.log('Starting vector store creation and file upload...');
createVectorStoreWithFiles()
    .then(({ vectorStoreId, fileIds, successCount, failCount }) => {
    console.log('\nProcess completed:');
    console.log('Vector store ID:', vectorStoreId);
    console.log('Successfully uploaded files:', successCount);
    console.log('Failed uploads:', failCount);
    // Save configuration
    const configPath = path.join(__dirname, '../../data/vector-store-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
        vectorStoreId,
        fileIds,
        successCount,
        failCount,
        timestamp: new Date().toISOString()
    }, null, 2));
    console.log('\nConfiguration saved to vector-store-config.json');
})
    .catch(error => {
    console.error('\nFailed to create vector store:', error);
    process.exit(1);
});
