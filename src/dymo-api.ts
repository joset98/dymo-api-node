import axios from "axios";
import * as Interfaces from "./lib/interfaces";
import * as PublicAPI from "./branches/public";
import * as PrivateAPI from "./branches/private";
import config, { BASE_URL, setBaseUrl } from "./config";
import { checkForUpdates } from "./services/autoupdate";

const customError = (code: number, message: string): Error => {
    return Object.assign(new Error(), { code, message: `[${config.lib.name}] ${message}` });
};

interface TokensResponse {
    root: boolean;
    api: boolean;
};

interface Tokens {
    root?: string;
    api?: string;
};

interface ServerEmailConfig {
    host: string;
    port: number;
    secure: boolean;
    auth: {
        user: string;
        pass: string;
    };
    dkim?: {
        domainName: string;
        keySelector: string;
        privateKey: string;
    };
};

class DymoAPI {
    private rootApiKey: string | null;
    private apiKey: string | null;
    private serverEmailConfig?: ServerEmailConfig;
    private local: boolean;
    private static tokensResponse: TokensResponse | null = null;
    private static tokensVerified: boolean | null = false;

    /**
     * @param {Object} options - Options to create the DymoAPI instance.
     * @param {string} [options.rootApiKey] - The root API key.
     * @param {string} [options.apiKey] - The API key.
     * @param {boolean} [options.local] - Whether to use a local server instead of the cloud server.
     * @param {Object} [options.serverEmailConfig] - The server email config.
     * @description
     * This is the main class to interact with the Dymo API. It should be
     * instantiated with the root API key and the API key. The root API key is
     * used to fetch the tokens and the API key is used to authenticate the
     * requests.
     * @example
     * const dymoApi = new DymoAPI({
     *     rootApiKey: "6bfb7675-6b69-4f8d-9f43-5a6f7f02c6c5",
     *     apiKey: "4c8b7675-6b69-4f8d-9f43-5a6f7f02c6c5",
     *     local: true
     * });
     */
    constructor(
        {
            rootApiKey = null,
            apiKey = null,
            local = false,
            serverEmailConfig = undefined
        }: {
            rootApiKey?: string | null;
            apiKey?: string | null;
            local?: boolean;
            serverEmailConfig?: ServerEmailConfig;
        } = {}) {
        this.rootApiKey = rootApiKey;
        this.apiKey = apiKey;
        this.serverEmailConfig = serverEmailConfig;
        this.local = rootApiKey ? local : false; // Only allow setting local if rootApiKey is defined.
        setBaseUrl(this.local);
        this.autoupdate();
        this.initializeTokens(); // Calls the function to obtain tokens when creating the object.
    }

    /**
     * Retrieves and caches authentication tokens.
     *
     * This method checks if cached tokens are available and valid. If so, it returns
     * the cached tokens. Otherwise, it generates new tokens using the provided API keys
     * and caches them. The tokens are fetched from the server using a POST request.
     *
     * The method also handles validation of root and API tokens, throwing errors if
     * any of the tokens are invalid. Cached tokens are considered valid for 5 minutes.
     *
     * @returns {Promise<TokensResponse|undefined>} A promise that resolves to the tokens response
     * if successful, or undefined if no tokens are available.
     * @throws Will throw an error if token validation fails, or if there is an issue
     * with the token retrieval process.
     */
    private async getTokens(): Promise<TokensResponse | undefined> {
        if (DymoAPI.tokensResponse && DymoAPI.tokensVerified) {
            console.log(`[${config.lib.name}] Using cached tokens response.`);
            return DymoAPI.tokensResponse;
        }

        const tokens: Tokens = {};
        if (this.rootApiKey) tokens.root = `Bearer ${this.rootApiKey}`;
        if (this.apiKey) tokens.api = `Bearer ${this.apiKey}`;

        try {
            if (Object.keys(tokens).length === 0) return;
            const response = await axios.post<TokensResponse>(`${BASE_URL}/v1/dvr/tokens`, { tokens });
            if (tokens.root && response.data.root === false) throw customError(3000, "Invalid root token.");
            if (tokens.api && response.data.api === false) throw customError(3000, "Invalid API token.");
            DymoAPI.tokensResponse = response.data;
            DymoAPI.tokensVerified = true;
            console.log(`[${config.lib.name}] Tokens initialized successfully.`);
            return DymoAPI.tokensResponse;
        } catch (error: any) {
            console.error(`[${config.lib.name}] ${error.message}`);
            throw new Error(`[${config.lib.name}] ${error.message}`);
        }
    }

    /**
     * Initializes the tokens response by calling getTokens().
     *
     * This method is called in the constructor and will throw an error if the
     * initialization process fails.
     *
     * @throws Will throw an error if there is an issue with the token retrieval
     * process.
     */
    private async initializeTokens(): Promise<void> {
        try {
            await this.getTokens();
        } catch (error: any) {
            console.error(`[${config.lib.name}] Error initializing tokens: ${error.message}`);
        }
    }

    /**
     * Checks for updates and logs a message if a new version is available.
     *
     * This method is called in the constructor and will throw an error if the
     * update check fails.
     *
     * @throws Will throw an error if there is an issue with the update check
     * process.
     */
    private async autoupdate(): Promise<void> {
        try {
            await checkForUpdates();
        } catch (error: any) {
            console.error(`[${config.lib.name}] Error checking the latest version in npmjs: ${error.message}`);
        }
    }

    // FUNCTIONS / Private.
    /**
     * Validates the given data against the configured validation settings.
     *
     * This method requires either the root API key or the API key to be set.
     * If neither is set, it will throw an error.
     *
     * @param {Object} data - The data to be validated.
     * @param {string} [data.email] - Optional email address to be validated.
     * @param {Interfaces.PhoneData} [data.phone] - Optional phone number data to be validated.
     * @param {string} [data.domain] - Optional domain name to be validated.
     * @param {string|Interfaces.CreditCardData} [data.creditCard] - Optional credit card number or data to be validated.
     * @param {string} [data.ip] - Optional IP address to be validated.
     * @param {string} [data.wallet] - Optional wallet address to be validated.
     * @param {Interfaces.VerifyPlugins[]} [data.plugins] - Optional array of verification plugins to be used.
     * @returns {Promise<Interfaces.DataValidationAnalysis>} A promise that resolves to the response from the server.
     * @throws Will throw an error if there is an issue with the validation process.
     */
    async isValidData(data: Interfaces.Validator): Promise<Interfaces.DataValidationAnalysis> {
        return await PrivateAPI.isValidData(this.rootApiKey || this.apiKey, data);
    }

    /**
     * Sends an email using the configured email client settings.
     *
     * This method requires either the root API key or the server email config to be set.
     * If neither is set, it will throw an error.
     *
     * @param {Object} data - The email data to be sent.
     * @param {string} data.from - The email address from which the email will be sent.
     * @param {string} data.to - The email address to which the email will be sent.
     * @param {string} data.subject - The subject of the email.
     * @param {string} [data.html] - The HTML content of the email.
     * @param {React.ReactElement} [data.react] - The React component to be rendered as the email content.
     * @param {Object} [data.options] - Content configuration options.
     * @param {"high" | "normal" | "low" | undefined} [data.options.priority="normal"] - Email priority (default: normal).
     * @param {boolean} [data.options.waitToResponse=true] - Wait until the email is sent (default: true).
     * @param {boolean} [data.options.composeTailwindClasses] - Whether to compose tailwind classes.
     * @param {Attachment[]} [data.attachments] - An array of attachments to be included in the email.
     * @param {string} data.attachments[].filename - The name of the attached file.
     * @param {string} [data.attachments[].path] - The path or URL of the attached file. Either this or `content` must be provided.
     * @param {Buffer} [data.attachments[].content] - The content of the attached file as a Buffer. Either this or `path` must be provided.
     * @param {string} [data.attachments[].cid] - The CID (Content-ID) of the attached file, used for inline images.
     * @returns {Promise<Interfaces.EmailStatus>} A promise that resolves to the response from the server.
     * @throws Will throw an error if there is an issue with the email sending process.
     */
    async sendEmail(data: any): Promise<Interfaces.EmailStatus> {
        if (!this.serverEmailConfig && !this.rootApiKey) console.error(`[${config.lib.name}] You must configure the email client settings.`);
        return await PrivateAPI.sendEmail(this.rootApiKey || this.apiKey, { serverEmailConfig: this.serverEmailConfig, ...data });
    }

    /**
     * Generates a random number between the provided min and max values.
     *
     * This method requires either the root API key or the API key to be set.
     * If neither is set, it will throw an error.
     *
     * @param {Interfaces.SRNG} data - The data to be sent.
     * @param {number} data.min - The minimum value of the range.
     * @param {number} data.max - The maximum value of the range.
     * @param {number} [data.quantity] - The number of random values to generate. Defaults to 1 if not provided.
     * @returns {Promise<Interfaces.SRNSummary>} A promise that resolves to the response from the server.
     * @throws Will throw an error if there is an issue with the random number generation process.
     */
    async getRandom(data: Interfaces.SRNG): Promise<Interfaces.SRNSummary> {
        return await PrivateAPI.getRandom(this.rootApiKey || this.apiKey, data);
    }

    // FUNCTIONS / Public.
    /**
     * Retrieves the prayer times for the given location.
     *
     * This method requires a latitude and longitude to be provided in the
     * data object. If either of these are not provided, it will throw an error.
     *
     * @param {Object} data - The data to be sent.
     * @param {number} data.lat - The latitude of the location.
     * @param {number} data.lon - The longitude of the location.
     * @returns {Promise<Interfaces.CountryPrayerTimes | { error: string }>} A promise that resolves to the response from the server.
     * @throws Will throw an error if there is an issue with the prayer times retrieval process.
     */
    async getPrayerTimes(data: Interfaces.PrayerTimesData): Promise<Interfaces.CountryPrayerTimes | { error: string }> {
        return await PublicAPI.getPrayerTimes(data);
    }

    /**
     * Satinizes the input, replacing any special characters with their HTML
     * entities.
     *
     * @param {Object} data - The data to be sent.
     * @param {string} data.input - The input to be satinized.
     * @returns {Promise<Interfaces.SatinizedInputAnalysis>} A promise that resolves to the response from the server.
     * @throws Will throw an error if there is an issue with the satinization process.
     */
    async satinizer(data: Interfaces.InputSatinizerData): Promise<Interfaces.SatinizedInputAnalysis> {
        return await PublicAPI.satinizer(data);
    }

    /**
     * Validates a password based on the given parameters.
     *
     * This method requires the password to be provided in the data object.
     * If the password is not provided, it will throw an error. The method
     * will validate the password against the following rules:
     *  - The password must be at least 8 characters long.
     *  - The password must be at most 32 characters long.
     *  - The password must contain at least one uppercase letter.
     *  - The password must contain at least one lowercase letter.
     *  - The password must contain at least one number.
     *  - The password must contain at least one special character.
     *  - The password must not contain any of the given banned words.
     *
     * @param {Object} data - The data to be sent.
     * @param {number} [data.min] - Minimum length of the password. Defaults to 8 if not provided.
     * @param {number} [data.max] - Maximum length of the password. Defaults to 32 if not provided.
     * @param {string} [data.email] - Optional email associated with the password.
     * @param {string} data.password - The password to be validated.
     * @param {string | string[]} [data.bannedWords] - The list of banned words that the password must not contain.
     * @returns {Promise<Interfaces.PasswordValidationResult>} A promise that resolves to the response from the server.
     * @throws Will throw an error if there is an issue with the password validation process.
     */
    async isValidPwd(data: Interfaces.IsValidPwdData): Promise<Interfaces.PasswordValidationResult> {
        return await PublicAPI.isValidPwd(data);
    }
}

export default DymoAPI;