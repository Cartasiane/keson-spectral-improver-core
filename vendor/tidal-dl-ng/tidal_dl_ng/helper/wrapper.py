"""Logger wrapper module for handling logging with optional debug tracebacks.

This module provides a wrapper class for logging functionality that allows
optional debug mode with full exception tracebacks.
"""

import traceback
from collections.abc import Callable
from typing import Any


class LoggerWrapped:
    """Wrapper for logging functionality with optional debug tracebacks.

    Attributes:
        fn_print (Callable): The function to use for printing messages.
        debug_mode (bool): Whether to enable debug mode with full tracebacks.
    """

    def __init__(self, fn_print: Callable, debug: bool = False) -> None:
        """Initialize the logger wrapper.

        Args:
            fn_print (Callable): The function to use for printing messages.
            debug (bool, optional): Enable debug mode with full tracebacks. Defaults to False.

        Returns:
            None
        """
        self.fn_print: Callable = fn_print
        self.debug_mode: bool = debug

    def debug(self, value: Any) -> None:
        """Log a debug message.

        Args:
            value (Any): The debug message to log.

        Returns:
            None
        """
        self.fn_print(value)

    def warning(self, value: Any) -> None:
        """Log a warning message.

        Args:
            value (Any): The warning message to log.

        Returns:
            None
        """
        self.fn_print(value)

    def info(self, value: Any) -> None:
        """Log an informational message.

        Args:
            value (Any): The informational message to log.

        Returns:
            None
        """
        self.fn_print(value)

    def error(self, value: Any) -> None:
        """Log an error message.

        Args:
            value (Any): The error message to log.

        Returns:
            None
        """
        self.fn_print(value)

    def critical(self, value: Any) -> None:
        """Log a critical message.

        Args:
            value (Any): The critical message to log.

        Returns:
            None
        """
        self.fn_print(value)

    def exception(self, value: Any) -> None:
        """Log an exception with traceback.

        In debug mode, this will also print the full exception traceback.

        Args:
            value (Any): The message to log along with the exception traceback.

        Returns:
            None
        """
        self.fn_print(value)
        # Print the full exception traceback only if debug mode is enabled
        if self.debug_mode:
            tb = traceback.format_exc()
            if tb and tb.strip() != "NoneType: None":
                self.fn_print(tb)
