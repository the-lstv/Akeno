#include <iostream>
#include <chrono>

#include "x-parser.cpp"

int main() {

    std::ifstream file("./test.xw");
    std::string code((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());

    Parser<void*>::Options options;

    // options.onText = [&](std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view value, void* userData) {
    //     buffer += value;
    // };

    options.buffer = true;
    options.compact = true;

    // options.header = "123";

    Parser<void*> parser(options);

    std::cout << parser.parse(code) << std::endl;

    // int iterations = 0;
    // auto start = std::chrono::high_resolution_clock::now();
    // auto end = start + std::chrono::seconds(5);

    // while (std::chrono::high_resolution_clock::now() < end) {
    //     parser.parse(code);
    //     iterations++;
    // }

    // auto duration = std::chrono::high_resolution_clock::now() - start;
    // auto duration_sec = std::chrono::duration_cast<std::chrono::seconds>(duration).count();
    // int ops = iterations / static_cast<double>(duration_sec);
    // double avg_runtime = std::chrono::duration_cast<std::chrono::microseconds>(duration).count() / static_cast<double>(iterations);

    // std::cout << "Total iterations: " << iterations << std::endl;
    // std::cout << "Operations per second: " << ops << std::endl;
    // std::cout << "Average runtime per iteration (microseconds): " << avg_runtime << std::endl;

    return 0;
}