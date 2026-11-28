/* Fixed acceptance peer for the compact JSON messages emitted by the SDK. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    char line[32768];
    if (getenv("SIAAS_MCP_TEST_SECRET") || getenv("NODE_OPTIONS")) return 2;
    while (fgets(line, sizeof(line), stdin)) {
        char *id = strstr(line, "\"id\":");
        const char *result;
        if (!id) continue; /* Notifications have no response. */
        if (strstr(line, "\"method\":\"initialize\""))
            result = "{\"protocolVersion\":\"2025-11-25\",\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"},\"capabilities\":{\"tools\":{}}}";
        else if (strstr(line, "\"method\":\"tools/list\""))
            result = "{\"tools\":[{\"name\":\"echo\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\"}},\"required\":[\"text\"]}}]}";
        else if (strstr(line, "\"method\":\"tools/call\"") && strstr(line, "\"text\":\"scoped\""))
            result = "{\"content\":[{\"type\":\"text\",\"text\":\"Fixture echo: scoped\"}]}";
        else return 3;
        printf("{\"jsonrpc\":\"2.0\",\"id\":%ld,\"result\":%s}\n", strtol(id + 5, NULL, 10), result);
        fflush(stdout);
    }
    return 0;
}
