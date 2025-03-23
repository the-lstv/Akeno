// Example: programatically uploading files to a local Akeno CDN instance

const body = new backend.helper.bodyParser;
const cdn = backend.addon("cdn");

const files = [
    {
        filename: 'file',
        data: 'Hello, World!' // Buffer | ArrayBuffer | String | TypedArray | Array
    },

    // {
    //     filename: 'file2.txt',
    //     data: fs.readFileSync('file2.txt')
    // }
];

// Process and upload your files (the same way as the upload endpoint)
body.processFiles(files, "xxh3", async processed_files => {
    const results = await cdn.upload(processed_files);

    console.log(results);
});

// You can use the hash function of your choice. xxh3 (64-bit) is the fastest.
// Other choices include: md5, xxh32, xxh64, xxh128