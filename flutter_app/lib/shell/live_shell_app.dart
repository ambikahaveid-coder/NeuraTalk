import 'package:flutter/material.dart';

import 'live_shell_page.dart';

class NeuraTalkLiveShellApp extends StatelessWidget {
  const NeuraTalkLiveShellApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NeuraTalk',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1F8EF1),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: Colors.black,
        useMaterial3: true,
      ),
      home: const LiveShellPage(),
    );
  }
}
